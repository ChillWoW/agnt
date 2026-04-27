import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { ConversationPane } from "@/components/chat/ConversationPane";
import { useConversationStore } from "@/features/conversations";
import { useWorkspaceStore } from "@/features/workspaces";
import { useSplitPaneStore } from "@/features/split-panes";

export const Route = createFileRoute("/conversations/$conversationId")({
    component: ConversationRoute
});

function ConversationRoute() {
    const { conversationId } = Route.useParams();
    const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);

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
        if (!activeWorkspaceId) return;
        setFocusedPaneIndex(activeWorkspaceId, 0);
    }, [activeWorkspaceId, conversationId, setFocusedPaneIndex]);

    const focusedPaneIndex = useSplitPaneStore((s) =>
        activeWorkspaceId
            ? (s.focusedPaneIndexByWorkspace[activeWorkspaceId] ?? 0)
            : 0
    );
    const totalPanes = useSplitPaneStore((s) =>
        activeWorkspaceId
            ? (s.extraPanesByWorkspace[activeWorkspaceId]?.length ?? 0) + 1
            : 1
    );
    const splitActive = totalPanes > 1;

    return (
        <ConversationPane
            conversationId={conversationId}
            isPrimary
            isFocused={focusedPaneIndex === 0}
            splitActive={splitActive}
            onFocus={() => {
                if (!activeWorkspaceId) return;
                setFocusedPaneIndex(activeWorkspaceId, 0);
            }}
        />
    );
}
