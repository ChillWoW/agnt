import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { ChatInput } from "@/components/chat/ChatInput";
import { useConversationStore } from "@/features/conversations";
import { useWorkspaceStore } from "@/features/workspaces";
import { cn } from "@/lib/cn";

export const Route = createFileRoute("/conversations/$conversationId")({
    component: ConversationRoute
});

function StreamingDots() {
    return (
        <span className="inline-flex items-center gap-0.5">
            <span className="size-1 rounded-full bg-dark-400 animate-bounce [animation-delay:0ms]" />
            <span className="size-1 rounded-full bg-dark-400 animate-bounce [animation-delay:150ms]" />
            <span className="size-1 rounded-full bg-dark-400 animate-bounce [animation-delay:300ms]" />
        </span>
    );
}

function ConversationRoute() {
    const { conversationId } = Route.useParams();
    const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
    const {
        activeConversation,
        isLoadingConversation,
        isStreaming,
        loadConversation,
        sendMessage,
        replyToConversation
    } = useConversationStore();
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const hasTriggeredReply = useRef(false);

    useEffect(() => {
        if (activeWorkspaceId) {
            hasTriggeredReply.current = false;
            void loadConversation(activeWorkspaceId, conversationId);
        }
    }, [activeWorkspaceId, conversationId, loadConversation]);

    // After loading a conversation, check if the last message is a user message
    // with no assistant response — if so, trigger a reply stream automatically.
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

    const visibleMessages = activeConversation.messages.filter(
        (m) => m.role === "user" || m.role === "assistant"
    );

    return (
        <div className="flex h-full flex-col">
            <div className="flex-1 overflow-y-auto">
                <div className="mx-auto max-w-2xl px-4 py-6">
                    {visibleMessages.map((message) => (
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
                                {message.isStreaming && message.content === "" ? (
                                    <StreamingDots />
                                ) : (
                                    <p className="whitespace-pre-wrap">{message.content}</p>
                                )}
                                {message.isStreaming && message.content !== "" && (
                                    <span className="ml-1 inline-block size-0.5 rounded-full bg-dark-300 animate-pulse" />
                                )}
                            </div>
                        </div>
                    ))}
                    <div ref={messagesEndRef} />
                </div>
            </div>

            <div className="shrink-0 border-t border-dark-800">
                <div className="mx-auto max-w-2xl px-4 py-3">
                    <ChatInput
                        onSend={handleSend}
                        isStreaming={isStreaming}
                        placeholder={isStreaming ? "Waiting for response..." : "Send a message..."}
                    />
                </div>
            </div>
        </div>
    );
}
