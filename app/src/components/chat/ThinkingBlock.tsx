import { BrainIcon } from "@phosphor-icons/react";
import { ToolBlock } from "./ToolCallCard";

interface ThinkingBlockProps {
    text?: string;
    startedAt?: string;
    endedAt?: string | null;
    isActive?: boolean;
}

function parseIso(value: string | null | undefined): number | null {
    if (!value) return null;
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) ? ms : null;
}

function formatDurationSeconds(seconds: number): string {
    const rounded = Math.max(1, Math.round(seconds));
    return `for ${rounded} second${rounded === 1 ? "" : "s"}`;
}

export function ThinkingBlock({
    text,
    startedAt,
    endedAt,
    isActive
}: ThinkingBlockProps) {
    const showPending = !!isActive && !endedAt;

    let detail: string | undefined;
    if (!showPending) {
        const started = parseIso(startedAt);
        const ended = parseIso(endedAt);
        if (started !== null && ended !== null && ended >= started) {
            detail = formatDurationSeconds((ended - started) / 1000);
        }
    }

    if (!showPending && !text) return null;

    return (
        <ToolBlock
            icon={<BrainIcon className="size-3.5 shrink-0" weight="bold" />}
            pendingLabel="Thinking"
            successLabel="Thought"
            detail={detail}
            status={showPending ? "pending" : "success"}
            autoOpen
            autoClose
        >
            {text && (
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-dark-300">
                    {text}
                </p>
            )}
        </ToolBlock>
    );
}
