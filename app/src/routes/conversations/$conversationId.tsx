import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
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

    const conversation = useConversationStore(
        (s) => s.conversationsById[conversationId] ?? null
    );
    const isLoadingConversation = useConversationStore((s) =>
        Boolean(s.loadingConversationIds[conversationId])
    );
    const isStreaming = useConversationStore((s) =>
        Boolean(s.streamControllersById[conversationId])
    );
    const loadConversation = useConversationStore((s) => s.loadConversation);
    const sendMessage = useConversationStore((s) => s.sendMessage);
    const stopGeneration = useConversationStore((s) => s.stopGeneration);

    useEffect(() => {
        if (activeWorkspaceId) {
            void loadConversation(activeWorkspaceId, conversationId);
        }
    }, [activeWorkspaceId, conversationId, loadConversation]);

    const handleSend = (content: string, attachmentIds: string[]) => {
        if (!activeWorkspaceId || !conversation) return;
        void sendMessage(
            activeWorkspaceId,
            conversation.id,
            content,
            attachmentIds
        );
    };

    const handleStop = () => {
        stopGeneration(conversationId);
    };

    if (isLoadingConversation && !conversation) {
        return (
            <div className="flex h-full items-center justify-center">
                <span className="text-sm text-dark-300">Loading...</span>
            </div>
        );
    }

    if (!conversation) {
        return (
            <div className="flex h-full items-center justify-center">
                <span className="text-sm text-dark-300">
                    Conversation not found
                </span>
            </div>
        );
    }

    const visibleMessages = conversation.messages.filter(
        (m) => m.role === "user" || m.role === "assistant"
    );

    return (
        <div className="relative flex h-full flex-col">
            <div
                className="min-h-0 flex-1 overflow-hidden"
                style={{
                    WebkitMaskImage: "linear-gradient(to bottom, black calc(100% - 4rem), transparent 100%)",
                    maskImage: "linear-gradient(to bottom, black calc(100% - 4rem), transparent 100%)"
                }}
            >
                <MessageList messages={visibleMessages} />
            </div>

            <div className="shrink-0">
                <div className="mx-auto max-w-3xl px-4 pt-4 pb-2">
                    <ChatInput
                        onSend={handleSend}
                        onStop={handleStop}
                        isStreaming={isStreaming}
                        workspaceId={activeWorkspaceId}
                        conversationId={conversation.id}
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
