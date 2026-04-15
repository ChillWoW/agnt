import { cn } from "@/lib/cn";
import type { Message } from "@/features/conversations/conversation-types";
import { StreamingDots } from "./StreamingDots";

interface MessageBubbleProps {
    message: Message;
}

export function MessageBubble({ message }: MessageBubbleProps) {
    const isUser = message.role === "user";

    return (
        <div
            className={cn(
                "mb-4 flex",
                isUser ? "justify-end" : "justify-start"
            )}
        >
            <div
                className={cn(
                    "text-sm leading-relaxed",
                    isUser
                        ? "max-w-[85%] rounded-md px-2.5 py-1 bg-dark-850 border border-dark-700 text-dark-50"
                        : "w-full text-dark-50"
                )}
            >
                {message.isStreaming && message.content === "" ? (
                    <StreamingDots />
                ) : (
                    <p className="whitespace-pre-wrap">{message.content}</p>
                )}
            </div>
        </div>
    );
}
