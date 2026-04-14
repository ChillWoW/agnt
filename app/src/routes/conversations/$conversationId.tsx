import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { ChatInput } from "@/components/chat/ChatInput";
import { useConversationStore } from "@/features/conversations";
import { useWorkspaceStore } from "@/features/workspaces";
import { cn } from "@/lib/cn";

export const Route = createFileRoute("/conversations/$conversationId")({
    component: ConversationRoute
});

function ConversationRoute() {
    const { conversationId } = Route.useParams();
    const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
    const { activeConversation, isLoadingConversation, loadConversation, sendMessage } =
        useConversationStore();
    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (activeWorkspaceId) {
            void loadConversation(activeWorkspaceId, conversationId);
        }
    }, [activeWorkspaceId, conversationId, loadConversation]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [activeConversation?.messages]);

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
                <span className="text-sm text-dark-300">Conversation not found</span>
            </div>
        );
    }

    return (
        <div className="flex h-full flex-col">
            <div className="flex-1 overflow-y-auto">
                <div className="mx-auto max-w-2xl px-4 py-6">
                    {activeConversation.messages.map((message) => (
                        <div
                            key={message.id}
                            className={cn(
                                "mb-4 flex",
                                message.role === "user" ? "justify-end" : "justify-start"
                            )}
                        >
                            <div
                                className={cn(
                                    "max-w-[85%] rounded-lg px-3.5 py-2.5 text-sm leading-relaxed",
                                    message.role === "user"
                                        ? "bg-dark-700 text-dark-50"
                                        : "bg-dark-800/50 text-dark-100"
                                )}
                            >
                                <p className="whitespace-pre-wrap">{message.content}</p>
                            </div>
                        </div>
                    ))}
                    <div ref={messagesEndRef} />
                </div>
            </div>

            <div className="shrink-0 border-t border-dark-800">
                <div className="mx-auto max-w-2xl px-4 py-3">
                    <ChatInput onSend={handleSend} placeholder="Send a message..." />
                </div>
            </div>
        </div>
    );
}
