import { useState } from "react";
import { BrainIcon, CaretDownIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";

interface ThinkingBlockProps {
    reasoning?: string;
    isReasoning?: boolean;
}

export function ThinkingBlock({ reasoning, isReasoning }: ThinkingBlockProps) {
    const [expanded, setExpanded] = useState(false);

    if (!isReasoning && !reasoning) return null;

    const isDone = !isReasoning && !!reasoning;

    return (
        <div className="mb-2">
            <button
                type="button"
                onClick={() => isDone && setExpanded((v) => !v)}
                className={cn(
                    "flex items-center gap-1.5 text-xs transition-colors",
                    isDone
                        ? "cursor-pointer text-dark-300 hover:text-dark-200"
                        : "cursor-default"
                )}
            >
                <BrainIcon
                    className={cn(
                        "size-3.5 shrink-0",
                        isReasoning ? "text-dark-300" : "text-dark-400"
                    )}
                    weight="bold"
                />
                <span
                    className={cn(
                        isReasoning ? "wave-text" : "text-dark-300 font-medium"
                    )}
                >
                    {isReasoning ? "Thinking" : "Thought"}
                </span>
                {isDone && (
                    <CaretDownIcon
                        className={cn(
                            "size-3 shrink-0 transition-transform",
                            expanded && "rotate-180"
                        )}
                        weight="bold"
                    />
                )}
            </button>

            {expanded && reasoning && (
                <div className="mt-1.5 max-h-48 overflow-y-auto rounded border border-dark-700 bg-dark-900 px-3 py-2">
                    <p className="whitespace-pre-wrap text-xs leading-relaxed text-dark-400">
                        {reasoning}
                    </p>
                </div>
            )}
        </div>
    );
}
