import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useWorkspaceStore } from "@/features/workspaces";

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
    /**
     * Workspace id this pane's conversation belongs to, or null when no
     * pane scope is active (home screen / outside any split layout).
     * Components rendered inside a pane should prefer this over the
     * globally-active workspace, since panes from multiple workspaces
     * can be visible at the same time.
     */
    workspaceId: string | null;
    /** Position in the split layout. 0 = primary (URL-bound), 1+ = extras. */
    paneIndex: number;
}

const DEFAULT_SCOPE: PaneScope = {
    isFocused: true,
    conversationId: null,
    workspaceId: null,
    paneIndex: 0
};

const PaneScopeContext = createContext<PaneScope>(DEFAULT_SCOPE);

export function PaneScopeProvider({
    isFocused,
    conversationId,
    workspaceId,
    paneIndex,
    children
}: PaneScope & { children: ReactNode }) {
    const value = useMemo<PaneScope>(
        () => ({ isFocused, conversationId, workspaceId, paneIndex }),
        [isFocused, conversationId, workspaceId, paneIndex]
    );
    return (
        <PaneScopeContext.Provider value={value}>
            {children}
        </PaneScopeContext.Provider>
    );
}

/** Returns the full pane scope (focus, conversation id, workspace id,
 * pane index). */
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

/**
 * Resolve the workspace id for whichever pane the calling component is
 * rendered inside, falling back to the globally-active workspace when
 * no pane scope is set (e.g. home screen, settings, popovers rendered
 * outside any conversation pane).
 *
 * Prefer this over reading `activeWorkspaceId` directly anywhere a
 * component might be rendered inside a `ConversationPane` — split
 * panes can show conversations from different workspaces side-by-side,
 * and tying message/tool rendering to the global active workspace
 * would cross-wire URLs and paths.
 */
export function usePaneWorkspaceId(): string | null {
    const paneWorkspaceId = useContext(PaneScopeContext).workspaceId;
    const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
    return paneWorkspaceId ?? activeWorkspaceId;
}
