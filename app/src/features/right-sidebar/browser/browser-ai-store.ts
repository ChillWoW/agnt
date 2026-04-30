import { create } from "zustand";

/**
 * Tracks which browser tabs are currently being driven by the agent and
 * what they're doing right now. Powers the "AI is using browser" visual
 * effect (ring, status pill, pulsing tab pill).
 *
 * The bridge marks a tab as active on `browser-op-required` and clears
 * the entry on `browser-op-resolved`. Multiple parallel ops on the same
 * tab are stacked via `pendingCount` so a long op + a short op don't
 * race and clear the indicator early.
 */

export interface BrowserAiState {
    /** Op identifier ("read", "click", ...) for the most recent request. */
    op: string;
    /** Short human-readable label ("reading page", "clicking 'Submit'"). */
    label: string;
    /** Number of active ops on this tab — clear indicator only at zero. */
    pendingCount: number;
    /** Conversation that owns the activity (used for routing follow-ups). */
    conversationId: string;
    /** Wall-clock millis when the most recent op started. */
    startedAt: number;
}

interface BrowserAiStoreState {
    byTabId: Record<string, BrowserAiState>;

    beginOp: (
        tabId: string,
        info: { op: string; label: string; conversationId: string }
    ) => void;
    endOp: (tabId: string) => void;
    clearTab: (tabId: string) => void;
    clearAll: () => void;
}

export const useBrowserAiStore = create<BrowserAiStoreState>()((set) => ({
    byTabId: {},

    beginOp: (tabId, info) =>
        set((state) => {
            const prev = state.byTabId[tabId];
            return {
                byTabId: {
                    ...state.byTabId,
                    [tabId]: {
                        op: info.op,
                        label: info.label,
                        conversationId: info.conversationId,
                        pendingCount: (prev?.pendingCount ?? 0) + 1,
                        startedAt: Date.now()
                    }
                }
            };
        }),

    endOp: (tabId) =>
        set((state) => {
            const prev = state.byTabId[tabId];
            if (!prev) return {};
            const nextCount = Math.max(0, prev.pendingCount - 1);
            if (nextCount === 0) {
                const { [tabId]: _drop, ...rest } = state.byTabId;
                return { byTabId: rest };
            }
            return {
                byTabId: {
                    ...state.byTabId,
                    [tabId]: { ...prev, pendingCount: nextCount }
                }
            };
        }),

    clearTab: (tabId) =>
        set((state) => {
            if (!(tabId in state.byTabId)) return {};
            const { [tabId]: _drop, ...rest } = state.byTabId;
            return { byTabId: rest };
        }),

    clearAll: () => set({ byTabId: {} })
}));

export function isTabAiControlled(tabId: string): boolean {
    return Boolean(useBrowserAiStore.getState().byTabId[tabId]);
}
