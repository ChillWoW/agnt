import { BrainIcon } from "@phosphor-icons/react";
import { ToolBlock } from "./ToolCallCard";

interface ThinkingBlockProps {
    reasoning?: string;
    isReasoning?: boolean;
}

export function ThinkingBlock({ reasoning, isReasoning }: ThinkingBlockProps) {
    if (!isReasoning && !reasoning) return null;

    return (
        <ToolBlock
            icon={<BrainIcon className="size-3.5 shrink-0" weight="bold" />}
            pendingLabel="Thinking"
            doneLabel="Thought"
            status={isReasoning ? "pending" : "success"}
            autoOpen
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
