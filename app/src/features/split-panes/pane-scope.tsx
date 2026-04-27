import { createContext, useContext, useMemo, type ReactNode } from "react";

/**
 * Per-pane state surfaced to deeply-nested components (chat input, model
 * selector, mode selectors) without prop drilling.
 *
 * `isFocused` is the critical bit: when multiple panes are open at once,
 * each pane's `useHotkey` registrations would otherwise fight for global
 * keyboard events, with the most recently mounted pane winning every
 * hotkey ("hotkeys go to the latest opened split"). Pane-scoped hotkeys
 * combine their own `enabled` flag with `usePaneFocus()` so only the
 * focused pane handles the chord.
 *
 * The default outside any provider is `isFocused: true` so single-pane,
 * non-split contexts (e.g. tests, deep links rendered without
 * SplitPaneArea) keep working unchanged.
 */
interface PaneScope {
    isFocused: boolean;
    /** Conversation id rendered by this pane, or null for the home screen. */
    conversationId: string | null;
    /** Position in the split layout. 0 = primary (URL-bound), 1+ = extras. */
    paneIndex: number;
}

const DEFAULT_SCOPE: PaneScope = {
    isFocused: true,
    conversationId: null,
    paneIndex: 0
};

const PaneScopeContext = createContext<PaneScope>(DEFAULT_SCOPE);

export function PaneScopeProvider({
    isFocused,
    conversationId,
    paneIndex,
    children
}: PaneScope & { children: ReactNode }) {
    const value = useMemo<PaneScope>(
        () => ({ isFocused, conversationId, paneIndex }),
        [isFocused, conversationId, paneIndex]
    );
    return (
        <PaneScopeContext.Provider value={value}>
            {children}
        </PaneScopeContext.Provider>
    );
}

/** Returns the full pane scope (focus, conversation id, pane index). */
export function usePaneScope(): PaneScope {
    return useContext(PaneScopeContext);
}

/**
 * Convenience hook: returns whether the calling component is rendered
 * inside the focused split pane (or, outside any split layout, `true`).
 * Use this to gate `useHotkey({ enabled })` so secondary panes don't
 * steal hotkeys from the focused pane.
 */
export function usePaneFocus(): boolean {
    return useContext(PaneScopeContext).isFocused;
}
