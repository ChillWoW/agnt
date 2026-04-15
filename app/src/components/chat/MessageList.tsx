import { useEffect, useRef } from "react";
import type { Message } from "@/features/conversations/conversation-types";
import { MessageBubble } from "./MessageBubble";

interface MessageListProps {
    messages: Message[];
}

export function MessageList({ messages }: MessageListProps) {
    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    return (
        <div className="h-full overflow-y-auto">
            <div className="mx-auto max-w-3xl px-4 py-6">
                {messages.map((message) => (
                    <MessageBubble key={message.id} message={message} />
                ))}
                <div ref={messagesEndRef} />
            </div>
        </div>
    );
}
