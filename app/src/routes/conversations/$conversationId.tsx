import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { ConversationPane } from "@/components/chat/ConversationPane";
import { useConversationStore } from "@/features/conversations";
import { useWorkspaceStore } from "@/features/workspaces";
import {
    PaneScopeProvider,
    useSplitPaneStore,
    usePaneScope
} from "@/features/split-panes";

export const Route = createFileRoute("/conversations/$conversationId")({
    component: ConversationRoute
});

function ConversationRoute() {
    const { conversationId } = Route.useParams();

    // Resolve which workspace this conversation belongs to. Split panes
    // can render conversations from MULTIPLE workspaces simultaneously,
    // so the URL-bound primary pane can no longer just inherit the
    // globally-active workspace — it must match the conversation's
    // owner. The conversation store maintains a `conversationId →
    // workspaceId` map populated by every load/create code path; we
    // fall back to the active workspace only for the cold-start case
    // where the user deep-links into a conversation before any sidebar
    // load has populated the map.
    const ownerWorkspaceId = useConversationStore(
        (s) => s.workspaceIdByConversationId[conversationId] ?? null
    );
    const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
    const workspaceId = ownerWorkspaceId ?? activeWorkspaceId;

    // Mirror the URL's conversation id into the conversation-store so the
    // sidebar's "active row" highlight stays correct. The split-pane store
    // owns multi-pane focus separately; this is purely a single-source-of-
    // truth nudge for the URL-bound pane.
    const setActiveConversation = useConversationStore(
        (s) => s.setActiveConversation
    );
    useEffect(() => {
        setActiveConversation(conversationId);
    }, [conversationId, setActiveConversation]);

    // Whenever the URL changes the primary pane, snap focus back to the
    // primary. Without this, navigating via the sidebar (which targets the
    // primary slot) wouldn't move focus, leaving the focus indicator on a
    // secondary pane while the user just changed the leftmost view.
    const setFocusedPaneIndex = useSplitPaneStore(
        (s) => s.setFocusedPaneIndex
    );
    useEffect(() => {
        setFocusedPaneIndex(0);
    }, [conversationId, setFocusedPaneIndex]);

    const focusedPaneIndex = useSplitPaneStore((s) => s.focusedPaneIndex);
    const totalPanes = useSplitPaneStore((s) => s.extraPanes.length + 1);
    const splitActive = totalPanes > 1;

    // The outer pane scope (set by `SplitPaneArea` around the route's
    // outlet) only knows about pane index + focus state for the primary
    // slot — it can't know which conversation/workspace the URL resolved
    // to. Override the scope here so deeply-nested components (message
    // attachments, tool cards, anything reading `usePaneScope`) see the
    // correct ids for the URL-bound primary pane, just like secondary
    // panes set their scope from the split store.
    const outer = usePaneScope();

    return (
        <PaneScopeProvider
            isFocused={outer.isFocused}
            paneIndex={0}
            conversationId={conversationId}
            workspaceId={workspaceId}
        >
            <ConversationPane
                workspaceId={workspaceId}
                conversationId={conversationId}
                isPrimary
                isFocused={focusedPaneIndex === 0}
                splitActive={splitActive}
                onFocus={() => {
                    setFocusedPaneIndex(0);
                }}
            />
        </PaneScopeProvider>
    );
}
