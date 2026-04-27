import { cn } from "@/lib/cn";
import type {
    Message,
    ReasoningPart,
    ToolInvocation
} from "@/features/conversations/conversation-types";
import { resolveAttachmentContentUrl } from "@/features/attachments";
import { usePaneWorkspaceId } from "@/features/split-panes";
import { StreamingPlaceholder } from "./StreamingPlaceholder";
import { ToolCallCard } from "./ToolCallCard";
import { ThinkingBlock } from "./ThinkingBlock";
import { WorkedSummary, type WorkedEntry } from "./WorkedSummary";
import { MarkdownRenderer } from "@/components/markdown/markdown-renderer";
import { MessageAttachments } from "./MessageAttachments";
import { MessageFooter } from "./MessageFooter";
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
            seq: typeof part.message_seq === "number" ? part.message_seq : null,
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
    // Resolve attachments against this pane's owning workspace rather
    // than the globally-active one — split panes can render conversations
    // from multiple workspaces side-by-side, and using the active
    // workspace here would cross-wire attachment URLs.
    const workspaceId = usePaneWorkspaceId();

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
                        message.reasoning_started_at ??
                        new Date().toISOString(),
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

    // Whole-turn collapse: once the message has settled we stack every
    // reasoning block AND every tool call into a single "Worked for X"
    // pill so the answer rises to the top. While streaming we keep the
    // individual cards visible so the user can watch progress live.
    const isFinished = !message.isStreaming;

    const workedEntries: WorkedEntry[] = isFinished
        ? timeline.map((entry) =>
              entry.kind === "reasoning"
                  ? { kind: "reasoning", key: entry.key, part: entry.part }
                  : {
                        kind: "tool",
                        key: entry.key,
                        invocation: entry.invocation
                    }
          )
        : [];

    const workedDurationMs = (() => {
        if (!isFinished || workedEntries.length === 0) return 0;
        // Prefer the server-tracked active generation time (excludes
        // permission/question pauses). Fall back to first-entry → now for
        // legacy rows that don't carry the field.
        if (typeof message.generation_duration_ms === "number") {
            return Math.max(0, message.generation_duration_ms);
        }
        const firstStart = timeline[0]?.time;
        if (!Number.isFinite(firstStart)) return 0;
        return Math.max(0, Date.now() - firstStart);
    })();

    const showStreamingPlaceholder =
        message.isStreaming && !hasContent && !hasToolCalls && !hasReasoning;

    return (
        <div
            className={cn(
                "mb-4 flex",
                isUser ? "justify-end" : "justify-start"
            )}
        >
            <div
                className={cn(
                    "min-w-0 text-xs leading-relaxed",
                    isUser
                        ? "max-w-[85%] rounded-md border border-dark-700 bg-dark-850 px-2.5 py-0.5 text-dark-50"
                        : "group/message w-full text-dark-50"
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

                {isFinished && workedEntries.length > 0 ? (
                    <div className="mb-1">
                        <WorkedSummary
                            entries={workedEntries}
                            durationMs={workedDurationMs}
                        />
                    </div>
                ) : (
                    timeline.length > 0 && (
                        <div className="mb-1">
                            {timeline.map((entry) => {
                                if (entry.kind === "reasoning") {
                                    const part = entry.part;
                                    const isActive =
                                        !part.ended_at &&
                                        !!message.isReasoning;
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
                    )
                )}

                {showStreamingPlaceholder ? (
                    <StreamingPlaceholder />
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

                {!isUser && <MessageFooter message={message} />}
            </div>
        </div>
    );
}
