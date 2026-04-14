import { create } from "zustand";
import type { Conversation, ConversationWithMessages, Message } from "./conversation-types";
import * as conversationApi from "./conversation-api";

interface ConversationStoreState {
    conversationsByWorkspace: Record<string, Conversation[]>;
    activeConversation: ConversationWithMessages | null;
    isLoadingList: boolean;
    isLoadingConversation: boolean;

    loadConversations: (workspaceId: string) => Promise<void>;
    loadConversation: (workspaceId: string, conversationId: string) => Promise<void>;
    createConversation: (workspaceId: string, message: string) => Promise<ConversationWithMessages>;
    sendMessage: (workspaceId: string, conversationId: string, content: string) => Promise<Message>;
    deleteConversation: (workspaceId: string, conversationId: string) => Promise<void>;
    clearActiveConversation: () => void;
}

export const useConversationStore = create<ConversationStoreState>()((set, get) => ({
    conversationsByWorkspace: {},
    activeConversation: null,
    isLoadingList: false,
    isLoadingConversation: false,

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
        const message = await conversationApi.addMessage(workspaceId, conversationId, "user", content);

        set((state) => {
            const active = state.activeConversation;
            if (active && active.id === conversationId) {
                return {
                    activeConversation: {
                        ...active,
                        messages: [...active.messages, message]
                    }
                };
            }
            return {};
        });

        return message;
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
