import { create } from "zustand";
import { cancelQuestionsRequest, respondToQuestions } from "./question-api";
import type { QuestionsRequest } from "./types";

interface QuestionStoreState {
    pendingByConversationId: Record<string, QuestionsRequest[]>;
    respondingIds: Record<string, true>;

    setPending: (conversationId: string, request: QuestionsRequest) => void;
    clearPending: (conversationId: string) => void;
    clearPendingById: (conversationId: string, requestId: string) => void;
    respond: (
        workspaceId: string,
        conversationId: string,
        requestId: string,
        answers: string[][]
    ) => Promise<void>;
    cancel: (
        workspaceId: string,
        conversationId: string,
        requestId: string
    ) => Promise<void>;
}

function omitKey<V>(
    record: Record<string, V>,
    key: string
): Record<string, V> {
    if (!(key in record)) return record;
    const { [key]: _removed, ...rest } = record;
    return rest;
}

function removeRequest(
    record: Record<string, QuestionsRequest[]>,
    conversationId: string,
    requestId: string
): Record<string, QuestionsRequest[]> {
    const queue = record[conversationId];
    if (!queue || queue.length === 0) return record;

    const next = queue.filter((req) => req.id !== requestId);
    if (next.length === queue.length) return record;

    if (next.length === 0) {
        return omitKey(record, conversationId);
    }

    return { ...record, [conversationId]: next };
}

export const useQuestionStore = create<QuestionStoreState>()((set, get) => ({
    pendingByConversationId: {},
    respondingIds: {},

    setPending: (conversationId, request) =>
        set((state) => {
            const existing =
                state.pendingByConversationId[conversationId] ?? [];

            if (existing.some((req) => req.id === request.id)) {
                return {};
            }

            return {
                pendingByConversationId: {
                    ...state.pendingByConversationId,
                    [conversationId]: [...existing, request]
                }
            };
        }),

    clearPending: (conversationId) =>
        set((state) => ({
            pendingByConversationId: omitKey(
                state.pendingByConversationId,
                conversationId
            )
        })),

    clearPendingById: (conversationId, requestId) =>
        set((state) => ({
            pendingByConversationId: removeRequest(
                state.pendingByConversationId,
                conversationId,
                requestId
            )
        })),

    respond: async (workspaceId, conversationId, requestId, answers) => {
        if (get().respondingIds[requestId]) return;

        set((state) => ({
            respondingIds: { ...state.respondingIds, [requestId]: true }
        }));

        try {
            await respondToQuestions(
                workspaceId,
                conversationId,
                requestId,
                answers
            );
            // Server also emits `questions-resolved` over SSE which clears
            // the pending entry. Clear optimistically for snappier UX.
            set((state) => ({
                pendingByConversationId: removeRequest(
                    state.pendingByConversationId,
                    conversationId,
                    requestId
                )
            }));
        } finally {
            set((state) => ({
                respondingIds: omitKey(state.respondingIds, requestId)
            }));
        }
    },

    cancel: async (workspaceId, conversationId, requestId) => {
        if (get().respondingIds[requestId]) return;

        set((state) => ({
            respondingIds: { ...state.respondingIds, [requestId]: true }
        }));

        try {
            await cancelQuestionsRequest(
                workspaceId,
                conversationId,
                requestId
            );
            // Optimistically remove the pending entry; the server will also
            // emit `questions-resolved` with cancelled=true over SSE.
            set((state) => ({
                pendingByConversationId: removeRequest(
                    state.pendingByConversationId,
                    conversationId,
                    requestId
                )
            }));
        } finally {
            set((state) => ({
                respondingIds: omitKey(state.respondingIds, requestId)
            }));
        }
    }
}));
