import { BrainIcon } from "@phosphor-icons/react";
import { ToolBlock } from "./ToolCallCard";

interface ThinkingBlockProps {
    reasoning?: string;
    isReasoning?: boolean;
    reasoningStartedAt?: string;
    reasoningEndedAt?: string;
}

function formatThinkingDuration(
    reasoningStartedAt?: string,
    reasoningEndedAt?: string
): string | undefined {
    if (!reasoningStartedAt || !reasoningEndedAt) {
        return undefined;
    }

    const startedAt = new Date(reasoningStartedAt).getTime();
    const endedAt = new Date(reasoningEndedAt).getTime();

    if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt)) {
        return undefined;
    }

    const seconds = Math.max(1, Math.round((endedAt - startedAt) / 1000));
    return `for ${seconds} second${seconds === 1 ? "" : "s"}`;
}

export function ThinkingBlock({
    reasoning,
    isReasoning,
    reasoningStartedAt,
    reasoningEndedAt
}: ThinkingBlockProps) {
    if (!isReasoning && !reasoning) return null;

    const detail = !isReasoning
        ? formatThinkingDuration(reasoningStartedAt, reasoningEndedAt)
        : undefined;

    return (
        <ToolBlock
            icon={<BrainIcon className="size-3.5 shrink-0" weight="bold" />}
            pendingLabel="Thinking"
            successLabel="Thought"
            detail={detail || undefined}
            status={isReasoning ? "pending" : "success"}
            autoClose
        >
            {reasoning && (
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-dark-300">
                    {reasoning}
                </p>
            )}
        </ToolBlock>
    );
}
