import { cn } from "@/lib/cn";
import type {
    Message,
    ReasoningPart,
    ToolInvocation
} from "@/features/conversations/conversation-types";
import { resolveAttachmentContentUrl } from "@/features/attachments";
import { useWorkspaceStore } from "@/features/workspaces";
import { StreamingDots } from "./StreamingDots";
import { ToolCallCard } from "./ToolCallCard";
import { ThinkingBlock } from "./ThinkingBlock";
import { MarkdownRenderer } from "@/components/markdown/markdown-renderer";
import { MessageAttachments } from "./MessageAttachments";
import { MessageText } from "./MessageText";

interface MessageBubbleProps {
    message: Message;
}

type TimelineEntry =
    | {
          kind: "reasoning";
          key: string;
          part: ReasoningPart;
          seq: number | null;
          time: number;
          order: number;
      }
    | {
          kind: "tool";
          key: string;
          invocation: ToolInvocation;
          seq: number | null;
          time: number;
          order: number;
      };

function buildTimeline(message: Message): TimelineEntry[] {
    const entries: TimelineEntry[] = [];
    let order = 0;

    const reasoningParts = message.reasoning_parts ?? [];
    for (const part of reasoningParts) {
        const started = new Date(part.started_at).getTime();
        entries.push({
            kind: "reasoning",
            key: `reasoning-${part.id}`,
            part,
            seq:
                typeof part.message_seq === "number"
                    ? part.message_seq
                    : null,
            time: Number.isFinite(started) ? started : 0,
            order: order++
        });
    }

    const toolInvocations = message.tool_invocations ?? [];
    for (const invocation of toolInvocations) {
        const created = new Date(invocation.created_at).getTime();
        entries.push({
            kind: "tool",
            key: `tool-${invocation.id}`,
            invocation,
            seq:
                typeof invocation.message_seq === "number"
                    ? invocation.message_seq
                    : null,
            time: Number.isFinite(created) ? created : 0,
            order: order++
        });
    }

    // Prefer server-assigned message_seq (stream order). Fall back to
    // timestamps, then insertion order, so legacy rows without a seq still
    // render in a stable, sensible position.
    entries.sort((a, b) => {
        if (a.seq !== null && b.seq !== null && a.seq !== b.seq) {
            return a.seq - b.seq;
        }
        if (a.seq !== null && b.seq === null) return -1;
        if (a.seq === null && b.seq !== null) return 1;
        if (a.time !== b.time) return a.time - b.time;
        return a.order - b.order;
    });

    return entries;
}

function hasAnyReasoningText(parts: ReasoningPart[] | undefined): boolean {
    return !!parts?.some((part) => part.text.length > 0);
}

export function MessageBubble({ message }: MessageBubbleProps) {
    const isUser = message.role === "user";
    const hasContent = message.content.trim().length > 0;
    const toolInvocations = message.tool_invocations ?? [];
    const hasToolCalls = toolInvocations.length > 0;
    const attachments = message.attachments ?? [];
    const hasAttachments = attachments.length > 0;
    const workspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);

    const reasoningParts: ReasoningPart[] = (() => {
        if (message.reasoning_parts && message.reasoning_parts.length > 0) {
            return message.reasoning_parts;
        }
        if (message.reasoning && message.reasoning.length > 0) {
            return [
                {
                    id: `legacy-${message.id}`,
                    message_id: message.id,
                    text: message.reasoning,
                    started_at:
                        message.reasoning_started_at ?? message.created_at,
                    ended_at:
                        message.reasoning_ended_at ??
                        message.reasoning_started_at ??
                        message.created_at,
                    sort_index: 0
                }
            ];
        }
        if (message.isReasoning) {
            return [
                {
                    id: `streaming-${message.id}`,
                    message_id: message.id,
                    text: "",
                    started_at:
                        message.reasoning_started_at ?? new Date().toISOString(),
                    ended_at: null,
                    sort_index: 0
                }
            ];
        }
        return [];
    })();

    const hasReasoning =
        reasoningParts.length > 0 &&
        (hasAnyReasoningText(reasoningParts) || !!message.isReasoning);

    const timeline: TimelineEntry[] = (() => {
        if (reasoningParts === message.reasoning_parts) {
            return buildTimeline(message);
        }
        return buildTimeline({ ...message, reasoning_parts: reasoningParts });
    })();

    const showStreamingDots =
        message.isStreaming &&
        !hasContent &&
        !hasToolCalls &&
        !hasReasoning;

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

                {timeline.length > 0 && (
                    <div className="mb-1">
                        {timeline.map((entry) => {
                            if (entry.kind === "reasoning") {
                                const part = entry.part;
                                const isActive =
                                    !part.ended_at && !!message.isReasoning;
                                return (
                                    <ThinkingBlock
                                        key={entry.key}
                                        text={part.text}
                                        startedAt={part.started_at}
                                        endedAt={part.ended_at}
                                        isActive={isActive}
                                    />
                                );
                            }
                            return (
                                <ToolCallCard
                                    key={entry.key}
                                    invocation={entry.invocation}
                                />
                            );
                        })}
                    </div>
                )}

                {showStreamingDots ? (
                    <StreamingDots />
                ) : hasContent ? (
                    isUser ? (
                        <MessageText
                            content={message.content}
                            className="py-1 text-dark-50"
                        />
                    ) : (
                        <div>
                            <MarkdownRenderer
                                content={message.content}
                                isStreaming={message.isStreaming}
                            />
                        </div>
                    )
                ) : null}
            </div>
        </div>
    );
}
