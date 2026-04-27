import { create } from "zustand";
import { persist } from "zustand/middleware";

// Maximum number of panes (primary + secondaries) the main area can show at
// once. Picking 3 keeps each pane >= ~280px on common laptop widths and
// matches the side-by-side mental model the UX is built around.
export const MAX_PANES = 3;

// Min pane width in CSS px. Width fractions are clamped against this during
// drag-resize so panes never collapse to nothing.
export const MIN_PANE_WIDTH_PX = 280;

export interface SecondaryPane {
    /** Stable unique id for the pane (independent of conversation id). */
    id: string;
    /** Conversation rendered inside this pane. */
    conversationId: string;
}

export type InsertPosition = "before" | "after";

interface SplitPaneState {
    /**
     * Per-workspace list of secondary panes (panes other than the URL-bound
     * primary pane). Only the active workspace's entry is rendered at any
     * given moment, but inactive workspaces' layouts are kept around so they
     * are restored when the user switches back.
     */
    extraPanesByWorkspace: Record<string, SecondaryPane[]>;
    /**
     * Width fractions for ALL panes in the workspace, in order
     * `[primary, ...extras]`. Always sums to ~1. Length is `extras.length + 1`.
     */
    widthFractionsByWorkspace: Record<string, number[]>;
    /**
     * Index of the focused pane within `[primary, ...extras]`. 0 = primary,
     * 1 = first secondary, etc. Defaults to 0.
     */
    focusedPaneIndexByWorkspace: Record<string, number>;

    /**
     * Insert a new pane next to the focused one (or at the end when the
     * focused pane is the primary one). Caps the total pane count at
     * `MAX_PANES`. Returns the resulting pane index, or `null` when capped /
     * a no-op (e.g. the conversation is already in another pane on the same
     * workspace).
     */
    addPane(
        workspaceId: string,
        conversationId: string,
        opts?: { allowDuplicate?: boolean }
    ): number | null;

    /**
     * Insert at a specific position relative to a target pane index. Used by
     * the drop overlay's "insert left/right of this pane" zones.
     */
    insertPaneAt(
        workspaceId: string,
        conversationId: string,
        targetIndex: number,
        position: InsertPosition,
        opts?: { allowDuplicate?: boolean }
    ): number | null;

    /**
     * Remove the secondary pane at the given index (1-based, since 0 is the
     * URL-bound primary). Width fractions are renormalized.
     */
    removeSecondaryPane(workspaceId: string, paneIndex: number): void;

    /**
     * Replace the conversation rendered by the pane at `paneIndex`. For
     * `paneIndex === 0` (primary) this is a no-op since the primary is bound
     * to the URL — callers should navigate instead.
     */
    replaceSecondaryConversation(
        workspaceId: string,
        paneIndex: number,
        conversationId: string
    ): void;

    setFocusedPaneIndex(workspaceId: string, idx: number): void;
    setWidthFractions(workspaceId: string, fractions: number[]): void;

    /** Drop a conversation from every pane in every workspace. Used as a
     * cleanup when a conversation is archived/deleted. */
    forgetConversation(conversationId: string): void;

    /** Clear all panes for a workspace (e.g. when the workspace is closed). */
    clearWorkspace(workspaceId: string): void;
}

function evenFractions(count: number): number[] {
    if (count <= 0) return [];
    return Array.from({ length: count }, () => 1 / count);
}

function reFraction(prev: number[], nextLength: number): number[] {
    // Renormalize an existing fraction array to a new pane count by
    // distributing missing space evenly (or trimming). This keeps the user's
    // existing relative widths reasonably intact when adding/removing panes
    // while still summing to 1.
    if (nextLength <= 0) return [];
    if (prev.length === 0) return evenFractions(nextLength);
    if (prev.length === nextLength) {
        const sum = prev.reduce((a, b) => a + b, 0);
        if (sum <= 0) return evenFractions(nextLength);
        return prev.map((f) => f / sum);
    }
    if (nextLength > prev.length) {
        // New pane(s) get average share; existing panes shrink proportionally.
        const additions = nextLength - prev.length;
        const newPaneShare = additions / nextLength;
        const remaining = 1 - newPaneShare;
        const oldSum = prev.reduce((a, b) => a + b, 0) || 1;
        const scaled = prev.map((f) => (f / oldSum) * remaining);
        const perAddition = newPaneShare / additions;
        return [...scaled, ...Array(additions).fill(perAddition)];
    }
    // Removal: drop the tail or supplied indices — caller should pass the
    // already-reduced length. Renormalize whatever remains.
    const truncated = prev.slice(0, nextLength);
    const sum = truncated.reduce((a, b) => a + b, 0) || 1;
    return truncated.map((f) => f / sum);
}

function insertFraction(
    prev: number[],
    insertAt: number
): number[] {
    // Inserting a new pane: it claims a `1/(N+1)` share, every existing pane
    // contributes proportionally to free up that share.
    const nextLen = prev.length + 1;
    if (prev.length === 0) return evenFractions(nextLen);
    const newShare = 1 / nextLen;
    const remaining = 1 - newShare;
    const oldSum = prev.reduce((a, b) => a + b, 0) || 1;
    const scaled = prev.map((f) => (f / oldSum) * remaining);
    const next = [...scaled];
    next.splice(insertAt, 0, newShare);
    return next;
}

function removeFraction(prev: number[], removeAt: number): number[] {
    if (prev.length <= 1) return [];
    const next = prev.slice();
    next.splice(removeAt, 1);
    const sum = next.reduce((a, b) => a + b, 0) || 1;
    return next.map((f) => f / sum);
}

function makePaneId(): string {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
        return crypto.randomUUID();
    }
    return `pane-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

export const useSplitPaneStore = create<SplitPaneState>()(
    persist(
        (set, get) => ({
            extraPanesByWorkspace: {},
            widthFractionsByWorkspace: {},
            focusedPaneIndexByWorkspace: {},

            addPane: (workspaceId, conversationId, opts) => {
                const state = get();
                const extras = state.extraPanesByWorkspace[workspaceId] ?? [];
                const focused =
                    state.focusedPaneIndexByWorkspace[workspaceId] ?? 0;

                if (extras.length + 1 >= MAX_PANES) {
                    return null;
                }
                if (
                    !opts?.allowDuplicate &&
                    extras.some((p) => p.conversationId === conversationId)
                ) {
                    // Already shown in a secondary pane — focus that one
                    // instead of creating a duplicate.
                    const existingIdx = extras.findIndex(
                        (p) => p.conversationId === conversationId
                    );
                    if (existingIdx >= 0) {
                        get().setFocusedPaneIndex(
                            workspaceId,
                            existingIdx + 1
                        );
                    }
                    return existingIdx + 1;
                }

                // Insert after the focused pane. focused === 0 (primary) →
                // insert at the start of extras (becomes the leftmost
                // secondary, immediately to the right of primary).
                const insertExtrasAt =
                    focused === 0 ? 0 : Math.min(focused, extras.length);

                const nextExtras: SecondaryPane[] = extras.slice();
                nextExtras.splice(insertExtrasAt, 0, {
                    id: makePaneId(),
                    conversationId
                });

                // The fractions array spans [primary, ...extras], so the
                // insertion index there is `insertExtrasAt + 1`.
                const prevFractions =
                    state.widthFractionsByWorkspace[workspaceId] ??
                    evenFractions(extras.length + 1);
                const nextFractions = insertFraction(
                    prevFractions,
                    insertExtrasAt + 1
                );

                set({
                    extraPanesByWorkspace: {
                        ...state.extraPanesByWorkspace,
                        [workspaceId]: nextExtras
                    },
                    widthFractionsByWorkspace: {
                        ...state.widthFractionsByWorkspace,
                        [workspaceId]: nextFractions
                    },
                    focusedPaneIndexByWorkspace: {
                        ...state.focusedPaneIndexByWorkspace,
                        [workspaceId]: insertExtrasAt + 1
                    }
                });

                return insertExtrasAt + 1;
            },

            insertPaneAt: (
                workspaceId,
                conversationId,
                targetIndex,
                position,
                opts
            ) => {
                const state = get();
                const extras = state.extraPanesByWorkspace[workspaceId] ?? [];
                if (extras.length + 1 >= MAX_PANES) return null;
                if (
                    !opts?.allowDuplicate &&
                    extras.some((p) => p.conversationId === conversationId)
                ) {
                    return null;
                }

                // Translate a flat-pane-index target into an extras-array
                // index. targetIndex 0 is primary; only `position === "after"`
                // is meaningful there. position === "before" on the primary
                // is unsupported (primary is leftmost) — fall back to inserting
                // at extras[0].
                let insertExtrasAt: number;
                if (targetIndex === 0) {
                    insertExtrasAt = 0; // immediately right of primary
                } else {
                    const extrasIdx = targetIndex - 1;
                    insertExtrasAt =
                        position === "before" ? extrasIdx : extrasIdx + 1;
                }
                insertExtrasAt = Math.max(
                    0,
                    Math.min(insertExtrasAt, extras.length)
                );

                const nextExtras: SecondaryPane[] = extras.slice();
                nextExtras.splice(insertExtrasAt, 0, {
                    id: makePaneId(),
                    conversationId
                });

                const prevFractions =
                    state.widthFractionsByWorkspace[workspaceId] ??
                    evenFractions(extras.length + 1);
                const nextFractions = insertFraction(
                    prevFractions,
                    insertExtrasAt + 1
                );

                set({
                    extraPanesByWorkspace: {
                        ...state.extraPanesByWorkspace,
                        [workspaceId]: nextExtras
                    },
                    widthFractionsByWorkspace: {
                        ...state.widthFractionsByWorkspace,
                        [workspaceId]: nextFractions
                    },
                    focusedPaneIndexByWorkspace: {
                        ...state.focusedPaneIndexByWorkspace,
                        [workspaceId]: insertExtrasAt + 1
                    }
                });

                return insertExtrasAt + 1;
            },

            removeSecondaryPane: (workspaceId, paneIndex) => {
                if (paneIndex <= 0) return; // primary is URL-bound
                const state = get();
                const extras = state.extraPanesByWorkspace[workspaceId] ?? [];
                const extrasIdx = paneIndex - 1;
                if (extrasIdx < 0 || extrasIdx >= extras.length) return;

                const nextExtras = extras.slice();
                nextExtras.splice(extrasIdx, 1);

                const prevFractions =
                    state.widthFractionsByWorkspace[workspaceId] ??
                    evenFractions(extras.length + 1);
                const nextFractions = removeFraction(
                    prevFractions,
                    paneIndex
                );

                const focused =
                    state.focusedPaneIndexByWorkspace[workspaceId] ?? 0;
                let nextFocus = focused;
                if (focused === paneIndex) {
                    // Shift focus to the pane that took the closed pane's
                    // visual slot (or to the previous pane if we just closed
                    // the rightmost one).
                    nextFocus = Math.min(focused, nextExtras.length);
                } else if (focused > paneIndex) {
                    nextFocus = focused - 1;
                }

                set({
                    extraPanesByWorkspace: {
                        ...state.extraPanesByWorkspace,
                        [workspaceId]: nextExtras
                    },
                    widthFractionsByWorkspace: {
                        ...state.widthFractionsByWorkspace,
                        [workspaceId]: nextFractions
                    },
                    focusedPaneIndexByWorkspace: {
                        ...state.focusedPaneIndexByWorkspace,
                        [workspaceId]: nextFocus
                    }
                });
            },

            replaceSecondaryConversation: (
                workspaceId,
                paneIndex,
                conversationId
            ) => {
                if (paneIndex <= 0) return;
                const state = get();
                const extras = state.extraPanesByWorkspace[workspaceId] ?? [];
                const extrasIdx = paneIndex - 1;
                if (extrasIdx < 0 || extrasIdx >= extras.length) return;
                const next = extras.slice();
                next[extrasIdx] = { ...next[extrasIdx]!, conversationId };
                set({
                    extraPanesByWorkspace: {
                        ...state.extraPanesByWorkspace,
                        [workspaceId]: next
                    }
                });
            },

            setFocusedPaneIndex: (workspaceId, idx) => {
                set((s) => ({
                    focusedPaneIndexByWorkspace: {
                        ...s.focusedPaneIndexByWorkspace,
                        [workspaceId]: Math.max(0, idx)
                    }
                }));
            },

            setWidthFractions: (workspaceId, fractions) => {
                set((s) => ({
                    widthFractionsByWorkspace: {
                        ...s.widthFractionsByWorkspace,
                        [workspaceId]: fractions
                    }
                }));
            },

            forgetConversation: (conversationId) => {
                const state = get();
                let changed = false;
                const nextExtras: Record<string, SecondaryPane[]> = {
                    ...state.extraPanesByWorkspace
                };
                const nextFractions: Record<string, number[]> = {
                    ...state.widthFractionsByWorkspace
                };
                const nextFocus: Record<string, number> = {
                    ...state.focusedPaneIndexByWorkspace
                };

                for (const [wsId, extras] of Object.entries(
                    state.extraPanesByWorkspace
                )) {
                    if (!extras.some((p) => p.conversationId === conversationId))
                        continue;

                    const filteredExtras = extras.filter(
                        (p) => p.conversationId !== conversationId
                    );
                    nextExtras[wsId] = filteredExtras;
                    nextFractions[wsId] = reFraction(
                        state.widthFractionsByWorkspace[wsId] ??
                            evenFractions(extras.length + 1),
                        filteredExtras.length + 1
                    );
                    const focused =
                        state.focusedPaneIndexByWorkspace[wsId] ?? 0;
                    nextFocus[wsId] = Math.min(
                        focused,
                        filteredExtras.length
                    );
                    changed = true;
                }

                if (!changed) return;
                set({
                    extraPanesByWorkspace: nextExtras,
                    widthFractionsByWorkspace: nextFractions,
                    focusedPaneIndexByWorkspace: nextFocus
                });
            },

            clearWorkspace: (workspaceId) => {
                set((s) => {
                    const nextExtras = { ...s.extraPanesByWorkspace };
                    const nextFractions = { ...s.widthFractionsByWorkspace };
                    const nextFocus = { ...s.focusedPaneIndexByWorkspace };
                    delete nextExtras[workspaceId];
                    delete nextFractions[workspaceId];
                    delete nextFocus[workspaceId];
                    return {
                        extraPanesByWorkspace: nextExtras,
                        widthFractionsByWorkspace: nextFractions,
                        focusedPaneIndexByWorkspace: nextFocus
                    };
                });
            }
        }),
        {
            name: "agnt:split-panes:v1",
            partialize: (state) => ({
                extraPanesByWorkspace: state.extraPanesByWorkspace,
                widthFractionsByWorkspace: state.widthFractionsByWorkspace,
                focusedPaneIndexByWorkspace: state.focusedPaneIndexByWorkspace
            })
        }
    )
);

// ─── Helpers ──────────────────────────────────────────────────────────────────
//
// The drag-and-drop overlay and the sidebar both need to construct/parse a
// payload representing a conversation being dragged from the sidebar to the
// main area. Centralising this avoids a typo splitting the producer and
// consumer.

export const SPLIT_PANE_DRAG_MIME = "application/x-agnt-conversation";

export interface SplitPaneDragPayload {
    workspaceId: string;
    conversationId: string;
}

export function readSplitPaneDragPayload(
    e: React.DragEvent | DragEvent
): SplitPaneDragPayload | null {
    const dt = e.dataTransfer;
    if (!dt) return null;
    const raw = dt.getData(SPLIT_PANE_DRAG_MIME);
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw) as Partial<SplitPaneDragPayload>;
        if (
            typeof parsed.workspaceId !== "string" ||
            typeof parsed.conversationId !== "string"
        ) {
            return null;
        }
        return {
            workspaceId: parsed.workspaceId,
            conversationId: parsed.conversationId
        };
    } catch {
        return null;
    }
}

export function isSplitPaneDrag(e: React.DragEvent | DragEvent): boolean {
    const dt = e.dataTransfer;
    if (!dt) return false;
    return Array.from(dt.types).includes(SPLIT_PANE_DRAG_MIME);
}
