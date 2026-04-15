import { create } from "zustand";
import type { Conversation, ConversationWithMessages, Message } from "./conversation-types";
import * as conversationApi from "./conversation-api";

interface ConversationStoreState {
    conversationsByWorkspace: Record<string, Conversation[]>;
    activeConversation: ConversationWithMessages | null;
    isLoadingList: boolean;
    isLoadingConversation: boolean;
    isStreaming: boolean;

    loadConversations: (workspaceId: string) => Promise<void>;
    loadConversation: (workspaceId: string, conversationId: string) => Promise<void>;
    createConversation: (workspaceId: string, message: string) => Promise<ConversationWithMessages>;
    sendMessage: (workspaceId: string, conversationId: string, content: string) => Promise<void>;
    replyToConversation: (workspaceId: string, conversationId: string) => Promise<void>;
    deleteConversation: (workspaceId: string, conversationId: string) => Promise<void>;
    clearActiveConversation: () => void;
}

type SseEventPayload = Record<string, unknown>;

async function consumeSseStream(
    response: Response,
    onEvent: (event: string, data: SseEventPayload) => void
): Promise<void> {
    if (!response.body) return;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            const parts = buffer.split("\n\n");
            buffer = parts.pop() ?? "";

            for (const chunk of parts) {
                const lines = chunk.split("\n");
                let event = "message";
                let dataLine = "";

                for (const line of lines) {
                    if (line.startsWith("event: ")) {
                        event = line.slice(7).trim();
                    } else if (line.startsWith("data: ")) {
                        dataLine = line.slice(6).trim();
                    }
                }

                if (dataLine) {
                    try {
                        const data = JSON.parse(dataLine) as SseEventPayload;
                        onEvent(event, data);
                    } catch {
                        // Malformed JSON — skip
                    }
                }
            }
        }
    } finally {
        reader.releaseLock();
    }
}

async function runStream(
    response: Response,
    conversationId: string,
    updateFn: (updater: (prev: ConversationWithMessages) => ConversationWithMessages) => void
): Promise<void> {
    await consumeSseStream(response, (event, data) => {
        switch (event) {
            case "user-message": {
                const msg: Message = {
                    id: data.id as string,
                    conversation_id: data.conversation_id as string,
                    role: "user",
                    content: data.content as string,
                    created_at: data.created_at as string
                };
                updateFn((prev) => {
                    if (prev.id !== conversationId) return prev;
                    // Replace optimistic message or add if not already present
                    const exists = prev.messages.some((m) => m.id === msg.id);
                    return {
                        ...prev,
                        messages: exists ? prev.messages : [...prev.messages, msg]
                    };
                });
                break;
            }

            case "assistant-start": {
                const msg: Message = {
                    id: data.id as string,
                    conversation_id: data.conversation_id as string,
                    role: "assistant",
                    content: "",
                    created_at: data.created_at as string,
                    isStreaming: true
                };
                updateFn((prev) => {
                    if (prev.id !== conversationId) return prev;
                    return { ...prev, messages: [...prev.messages, msg] };
                });
                break;
            }

            case "delta": {
                const delta = data.content as string;
                updateFn((prev) => {
                    if (prev.id !== conversationId) return prev;
                    const messages = prev.messages.map((m) => {
                        if (m.role === "assistant" && m.isStreaming) {
                            return { ...m, content: m.content + delta };
                        }
                        return m;
                    });
                    return { ...prev, messages };
                });
                break;
            }

            case "finish": {
                updateFn((prev) => {
                    if (prev.id !== conversationId) return prev;
                    const messages = prev.messages.map((m) => {
                        if (m.role === "assistant" && m.isStreaming) {
                            return { ...m, isStreaming: false };
                        }
                        return m;
                    });
                    return { ...prev, messages };
                });
                break;
            }

            case "error": {
                // Remove any streaming placeholder on error
                updateFn((prev) => {
                    if (prev.id !== conversationId) return prev;
                    const messages = prev.messages.filter(
                        (m) => !(m.role === "assistant" && m.isStreaming)
                    );
                    return { ...prev, messages };
                });
                break;
            }
        }
    });
}

export const useConversationStore = create<ConversationStoreState>()((set, get) => ({
    conversationsByWorkspace: {},
    activeConversation: null,
    isLoadingList: false,
    isLoadingConversation: false,
    isStreaming: false,

    loadConversations: async (workspaceId: string) => {
        const hadCached = workspaceId in get().conversationsByWorkspace;
        if (!hadCached) set({ isLoadingList: true });
        try {
            const conversations = await conversationApi.fetchConversations(workspaceId);
            set((state) => ({
                conversationsByWorkspace: {
                    ...state.conversationsByWorkspace,
                    [workspaceId]: conversations
                }
            }));
        } finally {
            if (!hadCached) set({ isLoadingList: false });
        }
    },

    loadConversation: async (workspaceId: string, conversationId: string) => {
        set({ isLoadingConversation: true });
        try {
            const conversation = await conversationApi.fetchConversation(workspaceId, conversationId);
            set({ activeConversation: conversation });
        } finally {
            set({ isLoadingConversation: false });
        }
    },

    createConversation: async (workspaceId: string, message: string) => {
        const conversation = await conversationApi.createConversation(workspaceId, message);

        set((state) => {
            const existing = state.conversationsByWorkspace[workspaceId] ?? [];
            return {
                activeConversation: conversation,
                conversationsByWorkspace: {
                    ...state.conversationsByWorkspace,
                    [workspaceId]: [conversation, ...existing]
                }
            };
        });

        return conversation;
    },

    sendMessage: async (workspaceId: string, conversationId: string, content: string) => {
        set({ isStreaming: true });

        const updateActive = (
            updater: (prev: ConversationWithMessages) => ConversationWithMessages
        ) => {
            set((state) => {
                if (!state.activeConversation) return {};
                return { activeConversation: updater(state.activeConversation) };
            });
        };

        try {
            const response = await conversationApi.streamMessage(workspaceId, conversationId, content);
            await runStream(response, conversationId, updateActive);
        } finally {
            set({ isStreaming: false });
            // Ensure no lingering streaming flags
            set((state) => {
                if (!state.activeConversation) return {};
                return {
                    activeConversation: {
                        ...state.activeConversation,
                        messages: state.activeConversation.messages.map((m) =>
                            m.isStreaming ? { ...m, isStreaming: false } : m
                        )
                    }
                };
            });
        }
    },

    replyToConversation: async (workspaceId: string, conversationId: string) => {
        set({ isStreaming: true });

        const updateActive = (
            updater: (prev: ConversationWithMessages) => ConversationWithMessages
        ) => {
            set((state) => {
                if (!state.activeConversation) return {};
                return { activeConversation: updater(state.activeConversation) };
            });
        };

        try {
            const response = await conversationApi.replyToConversation(workspaceId, conversationId);
            await runStream(response, conversationId, updateActive);
        } finally {
            set({ isStreaming: false });
            set((state) => {
                if (!state.activeConversation) return {};
                return {
                    activeConversation: {
                        ...state.activeConversation,
                        messages: state.activeConversation.messages.map((m) =>
                            m.isStreaming ? { ...m, isStreaming: false } : m
                        )
                    }
                };
            });
        }
    },

    deleteConversation: async (workspaceId: string, conversationId: string) => {
        await conversationApi.deleteConversation(workspaceId, conversationId);

        set((state) => {
            const existing = state.conversationsByWorkspace[workspaceId] ?? [];
            const updated = existing.filter((c) => c.id !== conversationId);

            return {
                conversationsByWorkspace: {
                    ...state.conversationsByWorkspace,
                    [workspaceId]: updated
                },
                activeConversation:
                    state.activeConversation?.id === conversationId
                        ? null
                        : state.activeConversation
            };
        });
    },

    clearActiveConversation: () => {
        set({ activeConversation: null });
    }
}));
