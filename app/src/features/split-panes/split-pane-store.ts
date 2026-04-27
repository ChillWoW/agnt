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
    /**
     * Workspace the conversation belongs to. Each pane carries its own
     * workspace so multiple workspaces can render side-by-side at the
     * same time — the layout no longer follows the globally "active"
     * workspace.
     */
    workspaceId: string;
    /** Conversation rendered inside this pane. */
    conversationId: string;
}

export type InsertPosition = "before" | "after";

interface SplitPaneState {
    /**
     * Flat list of secondary panes (panes other than the URL-bound primary
     * pane). Each pane carries its own `workspaceId`, so panes from
     * different workspaces can coexist side-by-side. Layout is global —
     * panes are NOT cleared / hidden when the user switches active
     * workspaces.
     */
    extraPanes: SecondaryPane[];
    /**
     * Width fractions for ALL panes in order `[primary, ...extras]`.
     * Always sums to ~1. Length is `extras.length + 1`.
     */
    widthFractions: number[];
    /**
     * Index of the focused pane within `[primary, ...extras]`. 0 = primary,
     * 1 = first secondary, etc.
     */
    focusedPaneIndex: number;

    /**
     * Insert a new pane next to the focused one (or at the end when the
     * focused pane is the primary one). Caps the total pane count at
     * `MAX_PANES`. Returns the resulting pane index, or `null` when capped /
     * a no-op (e.g. the conversation is already shown in another pane).
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
    removeSecondaryPane(paneIndex: number): void;

    /**
     * Replace the conversation rendered by the pane at `paneIndex`. For
     * `paneIndex === 0` (primary) this is a no-op since the primary is bound
     * to the URL — callers should navigate instead.
     */
    replaceSecondaryConversation(
        paneIndex: number,
        workspaceId: string,
        conversationId: string
    ): void;

    setFocusedPaneIndex(idx: number): void;
    setWidthFractions(fractions: number[]): void;

    /** Drop a conversation from every pane. Used as a cleanup when a
     * conversation is archived/deleted. */
    forgetConversation(conversationId: string): void;

    /** Drop every pane that belongs to a workspace (e.g. when the
     * workspace is closed/removed). */
    forgetWorkspace(workspaceId: string): void;
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
            extraPanes: [],
            widthFractions: [1],
            focusedPaneIndex: 0,

            addPane: (workspaceId, conversationId, opts) => {
                const state = get();
                const extras = state.extraPanes;
                const focused = state.focusedPaneIndex;

                if (extras.length + 1 >= MAX_PANES) {
                    return null;
                }
                if (
                    !opts?.allowDuplicate &&
                    extras.some(
                        (p) =>
                            p.conversationId === conversationId &&
                            p.workspaceId === workspaceId
                    )
                ) {
                    // Already shown in a secondary pane — focus that one
                    // instead of creating a duplicate.
                    const existingIdx = extras.findIndex(
                        (p) =>
                            p.conversationId === conversationId &&
                            p.workspaceId === workspaceId
                    );
                    if (existingIdx >= 0) {
                        set({ focusedPaneIndex: existingIdx + 1 });
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
                    workspaceId,
                    conversationId
                });

                // The fractions array spans [primary, ...extras], so the
                // insertion index there is `insertExtrasAt + 1`.
                const prevFractions =
                    state.widthFractions.length === extras.length + 1
                        ? state.widthFractions
                        : evenFractions(extras.length + 1);
                const nextFractions = insertFraction(
                    prevFractions,
                    insertExtrasAt + 1
                );

                set({
                    extraPanes: nextExtras,
                    widthFractions: nextFractions,
                    focusedPaneIndex: insertExtrasAt + 1
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
                const extras = state.extraPanes;
                if (extras.length + 1 >= MAX_PANES) return null;
                if (
                    !opts?.allowDuplicate &&
                    extras.some(
                        (p) =>
                            p.conversationId === conversationId &&
                            p.workspaceId === workspaceId
                    )
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
                    workspaceId,
                    conversationId
                });

                const prevFractions =
                    state.widthFractions.length === extras.length + 1
                        ? state.widthFractions
                        : evenFractions(extras.length + 1);
                const nextFractions = insertFraction(
                    prevFractions,
                    insertExtrasAt + 1
                );

                set({
                    extraPanes: nextExtras,
                    widthFractions: nextFractions,
                    focusedPaneIndex: insertExtrasAt + 1
                });

                return insertExtrasAt + 1;
            },

            removeSecondaryPane: (paneIndex) => {
                if (paneIndex <= 0) return; // primary is URL-bound
                const state = get();
                const extras = state.extraPanes;
                const extrasIdx = paneIndex - 1;
                if (extrasIdx < 0 || extrasIdx >= extras.length) return;

                const nextExtras = extras.slice();
                nextExtras.splice(extrasIdx, 1);

                const prevFractions =
                    state.widthFractions.length === extras.length + 1
                        ? state.widthFractions
                        : evenFractions(extras.length + 1);
                const nextFractions = removeFraction(prevFractions, paneIndex);

                const focused = state.focusedPaneIndex;
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
                    extraPanes: nextExtras,
                    widthFractions: nextFractions,
                    focusedPaneIndex: nextFocus
                });
            },

            replaceSecondaryConversation: (
                paneIndex,
                workspaceId,
                conversationId
            ) => {
                if (paneIndex <= 0) return;
                const state = get();
                const extras = state.extraPanes;
                const extrasIdx = paneIndex - 1;
                if (extrasIdx < 0 || extrasIdx >= extras.length) return;
                const next = extras.slice();
                next[extrasIdx] = {
                    ...next[extrasIdx]!,
                    workspaceId,
                    conversationId
                };
                set({ extraPanes: next });
            },

            setFocusedPaneIndex: (idx) => {
                set({ focusedPaneIndex: Math.max(0, idx) });
            },

            setWidthFractions: (fractions) => {
                set({ widthFractions: fractions });
            },

            forgetConversation: (conversationId) => {
                const state = get();
                const survivors = state.extraPanes.filter(
                    (p) => p.conversationId !== conversationId
                );
                if (survivors.length === state.extraPanes.length) return;

                const nextFractions = reFraction(
                    state.widthFractions.length === state.extraPanes.length + 1
                        ? state.widthFractions
                        : evenFractions(state.extraPanes.length + 1),
                    survivors.length + 1
                );
                const nextFocus = Math.min(
                    state.focusedPaneIndex,
                    survivors.length
                );
                set({
                    extraPanes: survivors,
                    widthFractions: nextFractions,
                    focusedPaneIndex: nextFocus
                });
            },

            forgetWorkspace: (workspaceId) => {
                const state = get();
                const survivors = state.extraPanes.filter(
                    (p) => p.workspaceId !== workspaceId
                );
                if (survivors.length === state.extraPanes.length) return;

                const nextFractions = reFraction(
                    state.widthFractions.length === state.extraPanes.length + 1
                        ? state.widthFractions
                        : evenFractions(state.extraPanes.length + 1),
                    survivors.length + 1
                );
                const nextFocus = Math.min(
                    state.focusedPaneIndex,
                    survivors.length
                );
                set({
                    extraPanes: survivors,
                    widthFractions: nextFractions,
                    focusedPaneIndex: nextFocus
                });
            }
        }),
        {
            // v2: split panes were rewritten from per-workspace dictionaries
            // (`extraPanesByWorkspace` / `widthFractionsByWorkspace` /
            // `focusedPaneIndexByWorkspace`) into a single global layout
            // where each pane carries its own `workspaceId`. Bumping the
            // persist key drops any v1 layouts so we don't try to hydrate
            // an incompatible shape.
            name: "agnt:split-panes:v2",
            partialize: (state) => ({
                extraPanes: state.extraPanes,
                widthFractions: state.widthFractions,
                focusedPaneIndex: state.focusedPaneIndex
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
