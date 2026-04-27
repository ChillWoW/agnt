import { useState } from "react";
import { CaretRightIcon, StackSimpleIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import type {
    ReasoningPart,
    ToolInvocation
} from "@/features/conversations/conversation-types";
import { ThinkingBlock } from "./ThinkingBlock";
import { ToolCallCard } from "./ToolCallCard";

/**
 * Formats a duration in milliseconds as a compact "Hh Mm Ss" string,
 * dropping leading zero units. Sub-second durations collapse to "<1s"
 * so the pill never displays a meaningless "0s".
 */
function formatWorkedDuration(durationMs: number): string {
    if (!Number.isFinite(durationMs) || durationMs <= 0) return "<1s";

    const totalSeconds = Math.round(durationMs / 1000);
    if (totalSeconds <= 0) return "<1s";

    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
        return `${hours}h ${minutes}m ${seconds}s`;
    }
    if (minutes > 0) {
        return `${minutes}m ${seconds}s`;
    }
    return `${seconds}s`;
}

export type WorkedEntry =
    | { kind: "reasoning"; key: string; part: ReasoningPart }
    | { kind: "tool"; key: string; invocation: ToolInvocation };

interface WorkedSummaryProps {
    entries: WorkedEntry[];
    durationMs: number;
}

/**
 * Single "Worked" pill that stacks an entire finished turn's reasoning
 * blocks AND tool calls behind one click-to-expand row showing the
 * wall-clock span of the work. Rendered by `MessageBubble` only after
 * the message has stopped streaming — while a turn is live the
 * individual ThinkingBlocks / ToolCallCards stay inline so the user
 * can watch progress in real time.
 */
export function WorkedSummary({ entries, durationMs }: WorkedSummaryProps) {
    const [expanded, setExpanded] = useState(false);

    if (entries.length === 0) return null;

    return (
        <div className="mb-2">
            <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                aria-expanded={expanded}
                className="flex cursor-pointer items-center gap-1 text-xs text-dark-200 transition-colors hover:text-dark-100"
            >
                <div className="flex items-center gap-1.5">
                    <StackSimpleIcon
                        className="size-3.5 shrink-0 text-dark-200"
                        weight="bold"
                    />
                    <span className="font-medium text-dark-200">Worked</span>
                </div>
                <span className="tabular-nums text-dark-300">
                    {formatWorkedDuration(durationMs)}
                </span>
                <CaretRightIcon
                    className={cn(
                        "size-3 shrink-0 transition-transform",
                        expanded && "rotate-90"
                    )}
                    weight="bold"
                />
            </button>

            {expanded && (
                <div className="mt-2 ml-1.5 border-l border-dark-700 pl-3">
                    {entries.map((entry) => {
                        if (entry.kind === "reasoning") {
                            const part = entry.part;
                            return (
                                <ThinkingBlock
                                    key={entry.key}
                                    text={part.text}
                                    startedAt={part.started_at}
                                    endedAt={part.ended_at}
                                    isActive={false}
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
        </div>
    );
}
