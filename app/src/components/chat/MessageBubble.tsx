import { cn } from "@/lib/cn";
import type { Message } from "@/features/conversations/conversation-types";
import { StreamingDots } from "./StreamingDots";
import { MarkdownRenderer } from "@/components/markdown/markdown-renderer";

interface MessageBubbleProps {
    message: Message;
}

export function MessageBubble({ message }: MessageBubbleProps) {
    const isUser = message.role === "user";
    const hasContent = message.content.trim().length > 0;

    return (
        <div
            className={cn(
                "mb-4 flex",
                isUser ? "justify-end" : "justify-start"
            )}
        >
            <div
                className={cn(
                    "min-w-0 text-sm leading-relaxed",
                    isUser
                        ? "max-w-[85%] rounded-md border border-dark-700 bg-dark-850 px-2.5 py-0.5 text-dark-50"
                        : "w-full text-dark-50"
                )}
            >
                {message.isStreaming && message.content === "" ? (
                    <StreamingDots />
                ) : (
                    <div
                        className={cn(
                            isUser &&
                                "[&_p]:text-dark-50 [&_code]:bg-dark-800 [&_pre]:bg-transparent"
                        )}
                    >
                        <MarkdownRenderer
                            content={hasContent ? message.content : " "}
                            isStreaming={message.isStreaming}
                        />
                    </div>
                )}
            </div>
        </div>
    );
}
