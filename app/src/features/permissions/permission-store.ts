import { create } from "zustand";
import { respondToPermission } from "./permission-api";
import type { PermissionDecision, PermissionRequest } from "./types";

interface PermissionStoreState {
    pendingByConversationId: Record<string, PermissionRequest[]>;
    respondingIds: Record<string, true>;

    setPending: (conversationId: string, request: PermissionRequest) => void;
    clearPending: (conversationId: string) => void;
    clearPendingById: (conversationId: string, requestId: string) => void;
    respond: (
        workspaceId: string,
        conversationId: string,
        requestId: string,
        decision: PermissionDecision
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
    record: Record<string, PermissionRequest[]>,
    conversationId: string,
    requestId: string
): Record<string, PermissionRequest[]> {
    const queue = record[conversationId];
    if (!queue || queue.length === 0) return record;

    const next = queue.filter((req) => req.id !== requestId);
    if (next.length === queue.length) return record;

    if (next.length === 0) {
        return omitKey(record, conversationId);
    }

    return { ...record, [conversationId]: next };
}

export const usePermissionStore = create<PermissionStoreState>()((set, get) => ({
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

    respond: async (workspaceId, conversationId, requestId, decision) => {
        if (get().respondingIds[requestId]) return;

        set((state) => ({
            respondingIds: { ...state.respondingIds, [requestId]: true }
        }));

        try {
            await respondToPermission(
                workspaceId,
                conversationId,
                requestId,
                decision
            );
            // Server will emit `permission-resolved` over SSE which clears the
            // pending entry. Clear optimistically for snappier UX and to
            // immediately reveal the next queued request (if any).
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
