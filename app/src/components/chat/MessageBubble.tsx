import { cn } from "@/lib/cn";
import type { Message } from "@/features/conversations/conversation-types";
import { resolveAttachmentContentUrl } from "@/features/attachments";
import { useWorkspaceStore } from "@/features/workspaces";
import { StreamingDots } from "./StreamingDots";
import { ToolCallCard } from "./ToolCallCard";
import { ThinkingBlock } from "./ThinkingBlock";
import { MarkdownRenderer } from "@/components/markdown/markdown-renderer";
import { MessageAttachments } from "./MessageAttachments";

interface MessageBubbleProps {
    message: Message;
}

export function MessageBubble({ message }: MessageBubbleProps) {
    const isUser = message.role === "user";
    const hasContent = message.content.trim().length > 0;
    const toolInvocations = message.tool_invocations ?? [];
    const hasToolCalls = toolInvocations.length > 0;
    const attachments = message.attachments ?? [];
    const hasAttachments = attachments.length > 0;
    const workspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
    const showStreamingDots =
        message.isStreaming && !hasContent && !hasToolCalls && !message.isReasoning && !message.reasoning;

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
                {hasAttachments && workspaceId && (
                    <MessageAttachments
                        attachments={attachments}
                        workspaceId={workspaceId}
                        resolveUrl={(id) =>
                            resolveAttachmentContentUrl(workspaceId, id)
                        }
                        isUser={isUser}
                    />
                )}

                {(message.reasoning || message.isReasoning) && (
                    <ThinkingBlock
                        reasoning={message.reasoning}
                        isReasoning={message.isReasoning}
                        reasoningStartedAt={message.reasoning_started_at}
                        reasoningEndedAt={message.reasoning_ended_at}
                    />
                )}

                {hasToolCalls && (
                    <div className="mb-1">
                        {toolInvocations.map((invocation) => (
                            <ToolCallCard
                                key={invocation.id}
                                invocation={invocation}
                            />
                        ))}
                    </div>
                )}

                {showStreamingDots ? (
                    <StreamingDots />
                ) : hasContent ? (
                    <div
                        className={cn(
                            isUser &&
                                "[&_p]:text-dark-50 [&_code]:bg-dark-800 [&_pre]:bg-transparent"
                        )}
                    >
                        <MarkdownRenderer
                            content={message.content}
                            isStreaming={message.isStreaming}
                        />
                    </div>
                ) : null}
            </div>
        </div>
    );
}
