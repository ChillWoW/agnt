import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { ChatInput } from "@/components/chat/ChatInput";
import { MessageList } from "@/components/chat/MessageList";
import { useConversationStore } from "@/features/conversations";
import { useWorkspaceStore } from "@/features/workspaces";

export const Route = createFileRoute("/conversations/$conversationId")({
    component: ConversationRoute
});

function ConversationRoute() {
    const { conversationId } = Route.useParams();
    const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
    const {
        activeConversation,
        isLoadingConversation,
        isStreaming,
        loadConversation,
        sendMessage,
        replyToConversation,
        stopGeneration
    } = useConversationStore();
    const hasTriggeredReply = useRef(false);

    useEffect(() => {
        if (activeWorkspaceId) {
            hasTriggeredReply.current = false;
            void loadConversation(activeWorkspaceId, conversationId);
        }
    }, [activeWorkspaceId, conversationId, loadConversation]);

    useEffect(() => {
        if (!activeConversation || !activeWorkspaceId) return;
        if (activeConversation.id !== conversationId) return;
        if (isStreaming || hasTriggeredReply.current) return;

        const messages = activeConversation.messages.filter(
            (m) => m.role === "user" || m.role === "assistant"
        );
        const lastMessage = messages[messages.length - 1];

        if (lastMessage?.role === "user") {
            hasTriggeredReply.current = true;
            void replyToConversation(activeWorkspaceId, conversationId);
        }
    }, [
        activeConversation,
        activeWorkspaceId,
        conversationId,
        isStreaming,
        replyToConversation
    ]);

    const handleSend = (content: string) => {
        if (!activeWorkspaceId || !activeConversation) return;
        void sendMessage(activeWorkspaceId, activeConversation.id, content);
    };

    if (isLoadingConversation && !activeConversation) {
        return (
            <div className="flex h-full items-center justify-center">
                <span className="text-sm text-dark-300">Loading...</span>
            </div>
        );
    }

    if (!activeConversation) {
        return (
            <div className="flex h-full items-center justify-center">
                <span className="text-sm text-dark-300">
                    Conversation not found
                </span>
            </div>
        );
    }

    const visibleMessages = activeConversation.messages.filter(
        (m) => m.role === "user" || m.role === "assistant"
    );

    return (
        <div className="flex h-full flex-col">
            <div className="min-h-0 flex-1 overflow-hidden">
                <MessageList messages={visibleMessages} />
            </div>

            <div className="shrink-0">
                <div className="mx-auto max-w-3xl px-4 py-3">
                    <ChatInput
                        onSend={handleSend}
                        onStop={stopGeneration}
                        isStreaming={isStreaming}
                        workspaceId={activeWorkspaceId}
                        conversationId={activeConversation.id}
                        placeholder={
                            isStreaming
                                ? "Waiting for response..."
                                : "Send a message..."
                        }
                    />
                </div>
            </div>
        </div>
    );
}
