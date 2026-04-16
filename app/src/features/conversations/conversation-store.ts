import { create } from "zustand";
import type {
    Conversation,
    ConversationWithMessages,
    Message,
    ToolInvocation,
    ToolInvocationStatus
} from "./conversation-types";
import * as conversationApi from "./conversation-api";

interface ConversationStoreState {
    conversationsByWorkspace: Record<string, Conversation[]>;
    activeConversation: ConversationWithMessages | null;
    isLoadingList: boolean;
    isLoadingConversation: boolean;
    isStreaming: boolean;
    streamAbortController: AbortController | null;
    stopGeneration: () => void;

    loadConversations: (workspaceId: string) => Promise<void>;
    loadConversation: (workspaceId: string, conversationId: string) => Promise<void>;
    createConversation: (workspaceId: string, message: string) => Promise<ConversationWithMessages>;
    sendMessage: (workspaceId: string, conversationId: string, content: string) => Promise<void>;
    replyToConversation: (workspaceId: string, conversationId: string) => Promise<void>;
    deleteConversation: (workspaceId: string, conversationId: string) => Promise<void>;
    clearActiveConversation: () => void;
}

type SseEventPayload = Record<string, unknown>;

function isAbortError(error: unknown): boolean {
    return error instanceof DOMException && error.name === "AbortError";
}

function finalizeStreamingMessages(messages: Message[]): Message[] {
    return messages.flatMap((message) => {
        if (!message.isStreaming) {
            return [message];
        }

        if (message.role === "assistant" && message.content.length === 0) {
            return [];
        }

        return [{ ...message, isStreaming: false }];
    });
}

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

            case "reasoning-start": {
                const messageId = data.messageId as string;
                updateFn((prev) => {
                    if (prev.id !== conversationId) return prev;
                    const messages = prev.messages.map((m) =>
                        m.id === messageId ? { ...m, isReasoning: true } : m
                    );
                    return { ...prev, messages };
                });
                break;
            }

            case "reasoning-delta": {
                const messageId = data.messageId as string;
                const text = data.text as string;
                updateFn((prev) => {
                    if (prev.id !== conversationId) return prev;
                    const messages = prev.messages.map((m) =>
                        m.id === messageId
                            ? { ...m, reasoning: (m.reasoning ?? "") + text }
                            : m
                    );
                    return { ...prev, messages };
                });
                break;
            }

            case "reasoning-end": {
                const messageId = data.messageId as string;
                updateFn((prev) => {
                    if (prev.id !== conversationId) return prev;
                    const messages = prev.messages.map((m) =>
                        m.id === messageId ? { ...m, isReasoning: false } : m
                    );
                    return { ...prev, messages };
                });
                break;
            }

            case "tool-call": {
                const invocation: ToolInvocation = {
                    id: data.id as string,
                    message_id: data.messageId as string,
                    tool_name: data.toolName as string,
                    input: data.input,
                    output: null,
                    error: null,
                    status: (data.status as ToolInvocationStatus) ?? "pending",
                    created_at:
                        (data.createdAt as string) ??
                        new Date().toISOString()
                };
                updateFn((prev) => {
                    if (prev.id !== conversationId) return prev;
                    const messages = prev.messages.map((m) => {
                        if (m.id !== invocation.message_id) return m;
                        const existing = m.tool_invocations ?? [];
                        return {
                            ...m,
                            tool_invocations: [...existing, invocation]
                        };
                    });
                    return { ...prev, messages };
                });
                break;
            }

            case "tool-result": {
                const messageId = data.messageId as string;
                const toolName = data.toolName as string;
                const output = data.output;
                const error = (data.error as string | null) ?? null;
                const status =
                    (data.status as ToolInvocationStatus) ??
                    (error ? "error" : "success");
                updateFn((prev) => {
                    if (prev.id !== conversationId) return prev;
                    const messages = prev.messages.map((m) => {
                        if (m.id !== messageId) return m;
                        const existing = m.tool_invocations ?? [];
                        let applied = false;
                        const tool_invocations = existing.map((inv) => {
                            if (
                                applied ||
                                inv.status !== "pending" ||
                                inv.tool_name !== toolName
                            ) {
                                return inv;
                            }
                            applied = true;
                            return {
                                ...inv,
                                status,
                                output,
                                error
                            };
                        });
                        return { ...m, tool_invocations };
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

            case "abort": {
                updateFn((prev) => {
                    if (prev.id !== conversationId) return prev;

                    const lastStreamingAssistantIndex = [...prev.messages]
                        .map((message, index) => ({ message, index }))
                        .reverse()
                        .find(({ message }) => message.role === "assistant" && message.isStreaming)
                        ?.index;

                    if (lastStreamingAssistantIndex == null) {
                        return prev;
                    }

                    const messages = prev.messages.flatMap((message, index) => {
                        if (index !== lastStreamingAssistantIndex) {
                            return [message];
                        }

                        if (message.content.length === 0) {
                            return [];
                        }

                        return [{ ...message, isStreaming: false }];
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
    streamAbortController: null,

    stopGeneration: () => {
        get().streamAbortController?.abort();
        set({ streamAbortController: null });
    },

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
        const current = get();

        // If we're currently streaming into this same conversation, don't
        // overwrite the in-memory state with a DB fetch — doing so drops the
        // `isStreaming` placeholder and subsequent delta/finish events have
        // nothing to update.
        if (
            current.isStreaming &&
            current.activeConversation?.id === conversationId
        ) {
            return;
        }

        set({ isLoadingConversation: true });
        try {
            const conversation = await conversationApi.fetchConversation(workspaceId, conversationId);
            // Guard against a stream starting while the fetch was in flight.
            const latest = get();
            if (
                latest.isStreaming &&
                latest.activeConversation?.id === conversationId
            ) {
                return;
            }
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
        if (get().isStreaming) {
            return;
        }

        const streamAbortController = new AbortController();
        set({ isStreaming: true, streamAbortController });

        const updateActive = (
            updater: (prev: ConversationWithMessages) => ConversationWithMessages
        ) => {
            set((state) => {
                if (!state.activeConversation) return {};
                return { activeConversation: updater(state.activeConversation) };
            });
        };

        try {
            const response = await conversationApi.streamMessage(
                workspaceId,
                conversationId,
                content,
                streamAbortController.signal
            );
            await runStream(response, conversationId, updateActive);
        } catch (error) {
            if (!isAbortError(error) && !streamAbortController.signal.aborted) {
                throw error;
            }
        } finally {
            set({ isStreaming: false, streamAbortController: null });
            // Ensure no lingering streaming flags
            set((state) => {
                if (!state.activeConversation) return {};
                return {
                    activeConversation: {
                        ...state.activeConversation,
                        messages: finalizeStreamingMessages(state.activeConversation.messages)
                    }
                };
            });
        }
    },

    replyToConversation: async (workspaceId: string, conversationId: string) => {
        if (get().isStreaming) {
            return;
        }

        const streamAbortController = new AbortController();
        set({ isStreaming: true, streamAbortController });

        const updateActive = (
            updater: (prev: ConversationWithMessages) => ConversationWithMessages
        ) => {
            set((state) => {
                if (!state.activeConversation) return {};
                return { activeConversation: updater(state.activeConversation) };
            });
        };

        try {
            const response = await conversationApi.replyToConversation(
                workspaceId,
                conversationId,
                streamAbortController.signal
            );
            await runStream(response, conversationId, updateActive);
        } catch (error) {
            if (!isAbortError(error) && !streamAbortController.signal.aborted) {
                throw error;
            }
        } finally {
            set({ isStreaming: false, streamAbortController: null });
            set((state) => {
                if (!state.activeConversation) return {};
                return {
                    activeConversation: {
                        ...state.activeConversation,
                        messages: finalizeStreamingMessages(state.activeConversation.messages)
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
