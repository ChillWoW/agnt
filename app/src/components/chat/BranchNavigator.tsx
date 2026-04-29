import { useCallback, useState } from "react";
import { CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { Tooltip } from "@/components/ui";
import type { BranchInfo } from "@/features/conversations";
import { useConversationStore } from "@/features/conversations";
import { usePaneWorkspaceId } from "@/features/split-panes";

interface BranchNavigatorProps {
    branchInfo: BranchInfo;
    conversationId: string;
    /**
     * When the conversation is mid-stream we lock the navigator so the
     * user can't switch out from under the in-flight branch.
     */
    isStreaming: boolean;
}

/**
 * `< 2 / 3 >` style branch switcher rendered next to the assistant
 * footer's copy + regenerate buttons. Only visible when the conversation
 * has an active branch group (server-side `branch_info`).
 */
export function BranchNavigator({
    branchInfo,
    conversationId,
    isStreaming
}: BranchNavigatorProps) {
    const workspaceId = usePaneWorkspaceId();
    const switchBranch = useConversationStore((s) => s.switchBranch);
    const [pending, setPending] = useState(false);

    const { activeIndex, total } = branchInfo;
    const canPrev = !isStreaming && !pending && activeIndex > 0;
    const canNext = !isStreaming && !pending && activeIndex < total - 1;

    const goTo = useCallback(
        async (index: number) => {
            if (!workspaceId) return;
            if (index < 0 || index >= total) return;
            setPending(true);
            try {
                await switchBranch(workspaceId, conversationId, index);
            } finally {
                setPending(false);
            }
        },
        [conversationId, switchBranch, total, workspaceId]
    );

    return (
        <div className="ml-0.5 flex items-center gap-0.5 text-[11px] text-dark-300">
            <Tooltip content="Previous response" side="top">
                <button
                    type="button"
                    onClick={() => goTo(activeIndex - 1)}
                    aria-label="Previous response"
                    disabled={!canPrev}
                    className={cn(
                        "flex size-5 items-center justify-center rounded transition-colors",
                        canPrev
                            ? "text-dark-200 hover:bg-dark-800 hover:text-dark-50"
                            : "cursor-not-allowed text-dark-500"
                    )}
                >
                    <CaretLeftIcon className="size-3" weight="bold" />
                </button>
            </Tooltip>
            <span className="select-none px-0.5 tabular-nums">
                {activeIndex + 1} / {total}
            </span>
            <Tooltip content="Next response" side="top">
                <button
                    type="button"
                    onClick={() => goTo(activeIndex + 1)}
                    aria-label="Next response"
                    disabled={!canNext}
                    className={cn(
                        "flex size-5 items-center justify-center rounded transition-colors",
                        canNext
                            ? "text-dark-200 hover:bg-dark-800 hover:text-dark-50"
                            : "cursor-not-allowed text-dark-500"
                    )}
                >
                    <CaretRightIcon className="size-3" weight="bold" />
                </button>
            </Tooltip>
        </div>
    );
}
