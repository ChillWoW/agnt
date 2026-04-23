import { create } from "zustand";
import { fetchPlan } from "./plan-api";
import type { Plan } from "./plan-types";

interface PlanStoreState {
    plansByConversationId: Record<string, Plan>;
    loadingIds: Record<string, true>;

    setPlan: (conversationId: string, plan: Plan) => void;
    clearPlan: (conversationId: string) => void;
    loadPlan: (workspaceId: string, conversationId: string) => Promise<void>;
}

function omitKey<V>(
    record: Record<string, V>,
    key: string
): Record<string, V> {
    if (!(key in record)) return record;
    const { [key]: _removed, ...rest } = record;
    return rest;
}

export const usePlanStore = create<PlanStoreState>()((set, get) => ({
    plansByConversationId: {},
    loadingIds: {},

    setPlan: (conversationId, plan) =>
        set((state) => ({
            plansByConversationId: {
                ...state.plansByConversationId,
                [conversationId]: plan
            }
        })),

    clearPlan: (conversationId) =>
        set((state) => ({
            plansByConversationId: omitKey(
                state.plansByConversationId,
                conversationId
            )
        })),

    loadPlan: async (workspaceId, conversationId) => {
        if (get().loadingIds[conversationId]) return;
        set((state) => ({
            loadingIds: { ...state.loadingIds, [conversationId]: true }
        }));
        try {
            const { plan } = await fetchPlan(workspaceId, conversationId);
            set((state) => ({
                plansByConversationId: {
                    ...state.plansByConversationId,
                    [conversationId]: plan
                }
            }));
        } catch {
            // plan may not exist yet
        } finally {
            set((state) => ({
                loadingIds: omitKey(state.loadingIds, conversationId)
            }));
        }
    }
}));
