import { create } from "zustand";
import type {
    Conversation,
    ConversationWithMessages,
    Message,
    ToolInvocation,
    ToolInvocationStatus
} from "./conversation-types";
import * as conversationApi from "./conversation-api";
import { usePermissionStore } from "@/features/permissions";
import type { PermissionRequest } from "@/features/permissions";

interface ConversationStoreState {
    conversationsByWorkspace: Record<string, Conversation[]>;
    conversationsById: Record<string, ConversationWithMessages>;
    activeConversationId: string | null;
    isLoadingList: boolean;
    loadingConversationIds: Record<string, true>;
    streamControllersById: Record<string, AbortController>;
    unreadConversationIds: Record<string, true>;

    setActiveConversation: (conversationId: string | null) => void;
    markConversationRead: (conversationId: string) => void;
    stopGeneration: (conversationId?: string) => void;

    loadConversations: (workspaceId: string) => Promise<void>;
    loadConversation: (workspaceId: string, conversationId: string) => Promise<void>;
    createConversation: (workspaceId: string, message: string) => Promise<ConversationWithMessages>;
    sendMessage: (workspaceId: string, conversationId: string, content: string) => Promise<void>;
    replyToConversation: (workspaceId: string, conversationId: string) => Promise<void>;
    deleteConversation: (workspaceId: string, conversationId: string) => Promise<void>;
    clearActiveConversation: () => void;
}

type SseEventPayload = Record<string, unknown>;
type StreamOutcome = "finished" | "aborted" | "errored";

function isAbortError(error: unknown): boolean {
    return error instanceof DOMException && error.name === "AbortError";
}

function omitKey<V>(
    record: Record<string, V>,
    key: string
): Record<string, V> {
    if (!(key in record)) return record;
    const { [key]: _removed, ...rest } = record;
    return rest;
}

function isAssistantMessageEmpty(message: Message): boolean {
    if (message.role !== "assistant") return false;
    if (message.content.length > 0) return false;
    if ((message.tool_invocations?.length ?? 0) > 0) return false;
    if ((message.reasoning?.length ?? 0) > 0) return false;
    return true;
}

function finalizeStreamingMessages(messages: Message[]): Message[] {
    return messages.flatMap((message) => {
        if (!message.isStreaming) {
            return [message];
        }

        if (isAssistantMessageEmpty(message)) {
            return [];
        }

        return [
            {
                ...message,
                isStreaming: false,
                isReasoning: false
            }
        ];
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
    conversationId: string,
    response: Response,
    updateConversation: (
        updater: (prev: ConversationWithMessages) => ConversationWithMessages
    ) => void
): Promise<StreamOutcome> {
    let outcome: StreamOutcome = "aborted";

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
                updateConversation((prev) => {
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
                updateConversation((prev) => ({
                    ...prev,
                    messages: [...prev.messages, msg]
                }));
                break;
            }

            case "delta": {
                const delta = data.content as string;
                updateConversation((prev) => {
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
                updateConversation((prev) => ({
                    ...prev,
                    messages: prev.messages.map((m) =>
                        m.id === messageId ? { ...m, isReasoning: true } : m
                    )
                }));
                break;
            }

            case "reasoning-delta": {
                const messageId = data.messageId as string;
                const text = data.text as string;
                updateConversation((prev) => ({
                    ...prev,
                    messages: prev.messages.map((m) =>
                        m.id === messageId
                            ? { ...m, reasoning: (m.reasoning ?? "") + text }
                            : m
                    )
                }));
                break;
            }

            case "reasoning-end": {
                const messageId = data.messageId as string;
                updateConversation((prev) => ({
                    ...prev,
                    messages: prev.messages.map((m) =>
                        m.id === messageId ? { ...m, isReasoning: false } : m
                    )
                }));
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
                updateConversation((prev) => ({
                    ...prev,
                    messages: prev.messages.map((m) => {
                        if (m.id !== invocation.message_id) return m;
                        const existing = m.tool_invocations ?? [];
                        return {
                            ...m,
                            tool_invocations: [...existing, invocation]
                        };
                    })
                }));
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
                updateConversation((prev) => ({
                    ...prev,
                    messages: prev.messages.map((m) => {
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
                    })
                }));
                break;
            }

            case "permission-required": {
                const request: PermissionRequest = {
                    id: data.id as string,
                    conversationId,
                    messageId: data.messageId as string,
                    toolName: data.toolName as string,
                    input: data.input,
                    createdAt:
                        (data.createdAt as string) ??
                        new Date().toISOString()
                };
                usePermissionStore
                    .getState()
                    .setPending(conversationId, request);
                break;
            }

            case "permission-resolved": {
                const requestId = data.id as string | undefined;
                if (requestId) {
                    usePermissionStore
                        .getState()
                        .clearPendingById(conversationId, requestId);
                } else {
                    usePermissionStore.getState().clearPending(conversationId);
                }
                break;
            }

            case "finish": {
                outcome = "finished";
                usePermissionStore.getState().clearPending(conversationId);
                updateConversation((prev) => ({
                    ...prev,
                    messages: prev.messages.map((m) => {
                        if (m.role === "assistant" && m.isStreaming) {
                            return { ...m, isStreaming: false };
                        }
                        return m;
                    })
                }));
                break;
            }

            case "abort": {
                outcome = "aborted";
                usePermissionStore.getState().clearPending(conversationId);
                updateConversation((prev) => {
                    const lastStreamingAssistantIndex = [...prev.messages]
                        .map((message, index) => ({ message, index }))
                        .reverse()
                        .find(
                            ({ message }) =>
                                message.role === "assistant" && message.isStreaming
                        )?.index;

                    if (lastStreamingAssistantIndex == null) {
                        return prev;
                    }

                    const messages = prev.messages.flatMap((message, index) => {
                        if (index !== lastStreamingAssistantIndex) {
                            return [message];
                        }

                        if (isAssistantMessageEmpty(message)) {
                            return [];
                        }

                        return [
                            {
                                ...message,
                                isStreaming: false,
                                isReasoning: false
                            }
                        ];
                    });

                    return { ...prev, messages };
                });
                break;
            }

            case "error": {
                outcome = "errored";
                usePermissionStore.getState().clearPending(conversationId);
                updateConversation((prev) => ({
                    ...prev,
                    messages: prev.messages.filter(
                        (m) => !(m.role === "assistant" && m.isStreaming)
                    )
                }));
                break;
            }
        }
    });

    return outcome;
}

export const useConversationStore = create<ConversationStoreState>()((set, get) => {
    function applyConversationUpdate(
        conversationId: string,
        updater: (prev: ConversationWithMessages) => ConversationWithMessages
    ) {
        set((state) => {
            const existing = state.conversationsById[conversationId];
            if (!existing) return {};
            return {
                conversationsById: {
                    ...state.conversationsById,
                    [conversationId]: updater(existing)
                }
            };
        });
    }

    async function runConversationStream(
        conversationId: string,
        startRequest: (signal: AbortSignal) => Promise<Response>
    ): Promise<void> {
        if (get().streamControllersById[conversationId]) {
            return;
        }

        const controller = new AbortController();
        set((state) => ({
            streamControllersById: {
                ...state.streamControllersById,
                [conversationId]: controller
            }
        }));

        let outcome: StreamOutcome = "aborted";

        try {
            const response = await startRequest(controller.signal);
            outcome = await runStream(conversationId, response, (updater) =>
                applyConversationUpdate(conversationId, updater)
            );
        } catch (error) {
            if (!isAbortError(error) && !controller.signal.aborted) {
                outcome = "errored";
                throw error;
            }
        } finally {
            set((state) => ({
                streamControllersById: omitKey(
                    state.streamControllersById,
                    conversationId
                )
            }));

            usePermissionStore.getState().clearPending(conversationId);

            applyConversationUpdate(conversationId, (prev) => ({
                ...prev,
                messages: finalizeStreamingMessages(prev.messages)
            }));

            if (
                outcome === "finished" &&
                get().activeConversationId !== conversationId
            ) {
                set((state) => ({
                    unreadConversationIds: {
                        ...state.unreadConversationIds,
                        [conversationId]: true
                    }
                }));
            }
        }
    }

    return {
        conversationsByWorkspace: {},
        conversationsById: {},
        activeConversationId: null,
        isLoadingList: false,
        loadingConversationIds: {},
        streamControllersById: {},
        unreadConversationIds: {},

        setActiveConversation: (conversationId: string | null) => {
            set((state) => {
                const patch: Partial<ConversationStoreState> = {
                    activeConversationId: conversationId
                };
                if (conversationId && state.unreadConversationIds[conversationId]) {
                    patch.unreadConversationIds = omitKey(
                        state.unreadConversationIds,
                        conversationId
                    );
                }
                return patch;
            });
        },

        markConversationRead: (conversationId: string) => {
            set((state) => {
                if (!state.unreadConversationIds[conversationId]) return {};
                return {
                    unreadConversationIds: omitKey(
                        state.unreadConversationIds,
                        conversationId
                    )
                };
            });
        },

        stopGeneration: (conversationId?: string) => {
            const targetId = conversationId ?? get().activeConversationId;
            if (!targetId) return;
            const controller = get().streamControllersById[targetId];
            if (!controller) return;
            controller.abort();
            usePermissionStore.getState().clearPending(targetId);
            set((state) => ({
                streamControllersById: omitKey(
                    state.streamControllersById,
                    targetId
                )
            }));
        },

        loadConversations: async (workspaceId: string) => {
            const hadCached = workspaceId in get().conversationsByWorkspace;
            if (!hadCached) set({ isLoadingList: true });
            try {
                const conversations =
                    await conversationApi.fetchConversations(workspaceId);
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

        loadConversation: async (
            workspaceId: string,
            conversationId: string
        ) => {
            set((state) => {
                const patch: Partial<ConversationStoreState> = {
                    activeConversationId: conversationId
                };
                if (state.unreadConversationIds[conversationId]) {
                    patch.unreadConversationIds = omitKey(
                        state.unreadConversationIds,
                        conversationId
                    );
                }
                return patch;
            });

            const state = get();

            // Already in memory (may be streaming) — nothing to fetch.
            if (state.conversationsById[conversationId]) {
                return;
            }

            if (state.loadingConversationIds[conversationId]) {
                return;
            }

            set((s) => ({
                loadingConversationIds: {
                    ...s.loadingConversationIds,
                    [conversationId]: true
                }
            }));

            try {
                const conversation = await conversationApi.fetchConversation(
                    workspaceId,
                    conversationId
                );

                set((s) => {
                    const next: Partial<ConversationStoreState> = {
                        loadingConversationIds: omitKey(
                            s.loadingConversationIds,
                            conversationId
                        )
                    };

                    // Don't clobber a stream that populated state while
                    // the fetch was in flight.
                    if (!s.conversationsById[conversationId]) {
                        next.conversationsById = {
                            ...s.conversationsById,
                            [conversationId]: conversation
                        };
                    }

                    return next;
                });
            } catch (error) {
                set((s) => ({
                    loadingConversationIds: omitKey(
                        s.loadingConversationIds,
                        conversationId
                    )
                }));
                throw error;
            }
        },

        createConversation: async (workspaceId: string, message: string) => {
            const conversation = await conversationApi.createConversation(
                workspaceId,
                message
            );

            set((state) => {
                const existing =
                    state.conversationsByWorkspace[workspaceId] ?? [];
                return {
                    activeConversationId: conversation.id,
                    conversationsById: {
                        ...state.conversationsById,
                        [conversation.id]: conversation
                    },
                    conversationsByWorkspace: {
                        ...state.conversationsByWorkspace,
                        [workspaceId]: [conversation, ...existing]
                    }
                };
            });

            return conversation;
        },

        sendMessage: async (
            workspaceId: string,
            conversationId: string,
            content: string
        ) => {
            await runConversationStream(conversationId, (signal) =>
                conversationApi.streamMessage(
                    workspaceId,
                    conversationId,
                    content,
                    signal
                )
            );
        },

        replyToConversation: async (
            workspaceId: string,
            conversationId: string
        ) => {
            await runConversationStream(conversationId, (signal) =>
                conversationApi.replyToConversation(
                    workspaceId,
                    conversationId,
                    signal
                )
            );
        },

        deleteConversation: async (
            workspaceId: string,
            conversationId: string
        ) => {
            get().streamControllersById[conversationId]?.abort();
            usePermissionStore.getState().clearPending(conversationId);

            await conversationApi.deleteConversation(
                workspaceId,
                conversationId
            );

            set((state) => {
                const existing =
                    state.conversationsByWorkspace[workspaceId] ?? [];

                return {
                    conversationsByWorkspace: {
                        ...state.conversationsByWorkspace,
                        [workspaceId]: existing.filter(
                            (c) => c.id !== conversationId
                        )
                    },
                    conversationsById: omitKey(
                        state.conversationsById,
                        conversationId
                    ),
                    streamControllersById: omitKey(
                        state.streamControllersById,
                        conversationId
                    ),
                    unreadConversationIds: omitKey(
                        state.unreadConversationIds,
                        conversationId
                    ),
                    loadingConversationIds: omitKey(
                        state.loadingConversationIds,
                        conversationId
                    ),
                    activeConversationId:
                        state.activeConversationId === conversationId
                            ? null
                            : state.activeConversationId
                };
            });
        },

        clearActiveConversation: () => {
            set({ activeConversationId: null });
        }
    };
});
