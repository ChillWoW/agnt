import { create } from "zustand";
import { fetchTodos } from "./todo-api";
import type { Todo } from "./types";

interface TodoStoreState {
    todosByConversationId: Record<string, Todo[]>;
    collapsedByConversationId: Record<string, boolean>;
    loadingIds: Record<string, true>;

    setTodos: (conversationId: string, todos: Todo[]) => void;
    clearTodos: (conversationId: string) => void;
    toggleCollapsed: (conversationId: string) => void;
    setCollapsed: (conversationId: string, collapsed: boolean) => void;
    loadTodos: (workspaceId: string, conversationId: string) => Promise<void>;
}

function omitKey<V>(
    record: Record<string, V>,
    key: string
): Record<string, V> {
    if (!(key in record)) return record;
    const { [key]: _removed, ...rest } = record;
    return rest;
}

export const useTodoStore = create<TodoStoreState>()((set, get) => ({
    todosByConversationId: {},
    collapsedByConversationId: {},
    loadingIds: {},

    setTodos: (conversationId, todos) =>
        set((state) => ({
            todosByConversationId: {
                ...state.todosByConversationId,
                [conversationId]: todos
            }
        })),

    clearTodos: (conversationId) =>
        set((state) => ({
            todosByConversationId: omitKey(
                state.todosByConversationId,
                conversationId
            )
        })),

    toggleCollapsed: (conversationId) =>
        set((state) => ({
            collapsedByConversationId: {
                ...state.collapsedByConversationId,
                [conversationId]:
                    !state.collapsedByConversationId[conversationId]
            }
        })),

    setCollapsed: (conversationId, collapsed) =>
        set((state) => ({
            collapsedByConversationId: {
                ...state.collapsedByConversationId,
                [conversationId]: collapsed
            }
        })),

    loadTodos: async (workspaceId, conversationId) => {
        if (get().loadingIds[conversationId]) return;
        set((state) => ({
            loadingIds: { ...state.loadingIds, [conversationId]: true }
        }));
        try {
            const { todos } = await fetchTodos(workspaceId, conversationId);
            set((state) => ({
                todosByConversationId: {
                    ...state.todosByConversationId,
                    [conversationId]: todos
                }
            }));
        } finally {
            set((state) => ({
                loadingIds: omitKey(state.loadingIds, conversationId)
            }));
        }
    }
}));
