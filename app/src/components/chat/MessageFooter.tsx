import { useCallback, useEffect, useRef, useState } from "react";
import {
    ArrowsClockwiseIcon,
    CheckIcon,
    CopyIcon
} from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { BinaryMatrix } from "@/features/left-sidebar/binary-matrix";
import { Tooltip, toast } from "@/components/ui";
import type { Message } from "@/features/conversations/conversation-types";
import { useConversationStore } from "@/features/conversations";
import { usePaneWorkspaceId } from "@/features/split-panes";
import { usePermissionStore } from "@/features/permissions";
import { useQuestionStore } from "@/features/questions";
import {
    estimateTurnCostUsd,
    formatCostUsd,
    formatTokenCount,
    getCachedModels,
    type ModelCatalogEntry
} from "@/features/models";
import { BranchNavigator } from "./BranchNavigator";

function formatDurationSeconds(durationMs: number): string {
    const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
    return totalSeconds + "s";
}

function findModel(modelId: string): ModelCatalogEntry | null {
    const models = getCachedModels();
    return models?.find((m) => m.id === modelId) ?? null;
}

function formatModelLabel(modelId: string): string {
    return findModel(modelId)?.displayName ?? modelId;
}

/**
 * Live generation timer that tracks elapsed wall-clock from the assistant
 * message's `created_at` but *pauses* whenever the conversation has a pending
 * permission or question request outstanding. Matches the server-side
 * accounting used to compute `generation_duration_ms`, so the live counter
 * and the final persisted value line up to the same second.
 */
function useLiveGenerationMs(conversationId: string, startedAtIso: string) {
    const startMs = new Date(startedAtIso).getTime();
    const pausedTotalRef = useRef(0);
    const pauseStartedAtRef = useRef<number | null>(null);
    const [, setTick] = useState(0);

    const isBlocked = usePermissionStore(
        (s) => (s.pendingByConversationId[conversationId]?.length ?? 0) > 0
    );
    const isQuestioning = useQuestionStore(
        (s) => (s.pendingByConversationId[conversationId]?.length ?? 0) > 0
    );
    const paused = isBlocked || isQuestioning;

    useEffect(() => {
        if (paused && pauseStartedAtRef.current === null) {
            pauseStartedAtRef.current = Date.now();
            return;
        }
        if (!paused && pauseStartedAtRef.current !== null) {
            pausedTotalRef.current += Date.now() - pauseStartedAtRef.current;
            pauseStartedAtRef.current = null;
        }
    }, [paused]);

    useEffect(() => {
        if (paused) return;
        const id = window.setInterval(() => {
            setTick((t) => t + 1);
        }, 250);
        return () => window.clearInterval(id);
    }, [paused]);

    if (!Number.isFinite(startMs)) {
        return { elapsedMs: 0, paused };
    }
    const pausedSoFar =
        pausedTotalRef.current +
        (pauseStartedAtRef.current !== null
            ? Date.now() - pauseStartedAtRef.current
            : 0);
    const elapsedMs = Math.max(0, Date.now() - startMs - pausedSoFar);
    return { elapsedMs, paused };
}

interface MessageFooterProps {
    message: Message;
    /**
     * True for the most recent assistant message in the conversation.
     * Only the latest assistant footer renders the regenerate button +
     * branch navigator — older turns are immutable.
     */
    isLatestAssistant?: boolean;
}

export function MessageFooter({
    message,
    isLatestAssistant = false
}: MessageFooterProps) {
    const isStreaming = !!message.isStreaming;
    const { elapsedMs } = useLiveGenerationMs(
        message.conversation_id,
        message.created_at
    );

    const [copied, setCopied] = useState(false);
    const handleCopy = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(message.content);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
        } catch (error) {
            toast.error({
                title: "Couldn't copy message",
                description:
                    error instanceof Error
                        ? error.message
                        : "Clipboard unavailable."
            });
        }
    }, [message.content]);

    const conversationStreaming = useConversationStore((s) =>
        Boolean(s.streamControllersById[message.conversation_id])
    );
    const branchInfo = useConversationStore(
        (s) => s.conversationsById[message.conversation_id]?.branch_info ?? null
    );
    // Subagent conversations are driven by their parent's `task` tool, not
    // by direct user input — branching them would orphan the parent's
    // tool result, so we hide the regenerate / branch UI entirely.
    const isSubagent = useConversationStore(
        (s) =>
            !!s.conversationsById[message.conversation_id]
                ?.parent_conversation_id
    );
    const regenerateLastTurn = useConversationStore(
        (s) => s.regenerateLastTurn
    );
    const workspaceId = usePaneWorkspaceId();
    const branchControlsAllowed = isLatestAssistant && !isSubagent;

    const handleRegenerate = useCallback(() => {
        if (!workspaceId) return;
        if (conversationStreaming) return;
        void regenerateLastTurn(workspaceId, message.conversation_id);
    }, [
        conversationStreaming,
        message.conversation_id,
        regenerateLastTurn,
        workspaceId
    ]);

    if (isStreaming) {
        return (
            <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-dark-200">
                <BinaryMatrix />
                <span className="tabular-nums">
                    {formatDurationSeconds(elapsedMs)}
                </span>
            </div>
        );
    }

    const durationMs = message.generation_duration_ms;
    const hasDuration = typeof durationMs === "number" && durationMs >= 0;
    const hasModel = !!(message.model_id && message.model_id.length > 0);

    // Cost is only shown once the turn has finished and the server has
    // persisted token usage on the assistant row. We re-resolve the model
    // from the cached catalog so we always price against the latest
    // pricing.standard rates (see `app/src/features/models/pricing.ts`).
    const inputTokens =
        typeof message.input_tokens === "number" ? message.input_tokens : null;
    const outputTokens =
        typeof message.output_tokens === "number"
            ? message.output_tokens
            : null;
    const reasoningTokens =
        typeof message.reasoning_tokens === "number"
            ? message.reasoning_tokens
            : null;
    const model = hasModel ? findModel(message.model_id as string) : null;
    const cost =
        model && inputTokens != null && outputTokens != null
            ? estimateTurnCostUsd(model, {
                  inputTokens,
                  outputTokens
              })
            : null;
    const hasCost = cost != null && cost.totalUsd > 0;

    const showBranchControls =
        branchControlsAllowed &&
        (branchInfo != null || message.content.length > 0);

    if (
        !hasDuration &&
        !hasModel &&
        !hasCost &&
        !message.content &&
        !showBranchControls
    ) {
        return null;
    }

    // Whole footer is hover-revealed (or focus-revealed for keyboard users)
    // so finished assistant turns stay visually clean unless the user
    // points at them. The `min-h-[1.25rem]` placeholder prevents layout
    // jump when the footer pops in/out on hover.
    return (
        <div
            className={cn(
                "mt-0.5 flex min-h-[1.25rem] items-center gap-2 text-[11px] text-dark-300 transition-opacity",
                "opacity-0 focus-within:opacity-100 group-hover/message:opacity-100",
                copied && "opacity-100"
            )}
        >
            {hasDuration && (
                <span>{formatDurationSeconds(durationMs as number)}</span>
            )}
            {hasModel && hasDuration && (
                <span className="text-dark-400">-</span>
            )}
            {hasModel && (
                <span>{formatModelLabel(message.model_id as string)}</span>
            )}
            {hasCost && (
                <>
                    <span className="text-dark-400">-</span>
                    <Tooltip
                        side="top"
                        content={
                            <CostTooltipContent
                                model={model as ModelCatalogEntry}
                                inputTokens={inputTokens as number}
                                outputTokens={outputTokens as number}
                                reasoningTokens={reasoningTokens}
                                cost={cost!}
                            />
                        }
                    >
                        <span className="cursor-help tabular-nums">
                            ~{formatCostUsd(cost!.totalUsd)}
                        </span>
                    </Tooltip>
                </>
            )}
            {message.content.length > 0 && (
                <Tooltip
                    content={copied ? "Copied" : "Copy message"}
                    side="top"
                >
                    <button
                        type="button"
                        onClick={handleCopy}
                        aria-label="Copy message"
                        className="ml-0.5 flex size-5.5 items-center justify-center rounded text-dark-300 hover:bg-dark-800 hover:text-dark-50"
                    >
                        {copied ? (
                            <CheckIcon className="size-3" weight="bold" />
                        ) : (
                            <CopyIcon className="size-3" weight="bold" />
                        )}
                    </button>
                </Tooltip>
            )}
            {branchControlsAllowed && (
                <Tooltip content="Regenerate response" side="top">
                    <button
                        type="button"
                        onClick={handleRegenerate}
                        aria-label="Regenerate response"
                        disabled={conversationStreaming}
                        className={cn(
                            "flex size-5.5 items-center justify-center rounded text-dark-300 hover:bg-dark-800 hover:text-dark-50",
                            conversationStreaming &&
                                "cursor-not-allowed opacity-30 hover:bg-transparent hover:text-dark-300"
                        )}
                    >
                        <ArrowsClockwiseIcon
                            className="size-3"
                            weight="bold"
                        />
                    </button>
                </Tooltip>
            )}
            {branchControlsAllowed && branchInfo && branchInfo.total > 1 && (
                <BranchNavigator
                    branchInfo={branchInfo}
                    conversationId={message.conversation_id}
                    isStreaming={conversationStreaming}
                />
            )}
        </div>
    );
}

interface CostTooltipContentProps {
    model: ModelCatalogEntry;
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number | null;
    cost: NonNullable<ReturnType<typeof estimateTurnCostUsd>>;
}

function CostTooltipContent({
    model,
    inputTokens,
    outputTokens,
    reasoningTokens,
    cost
}: CostTooltipContentProps) {
    return (
        <div className="flex max-w-xs flex-col gap-1.5 text-[11px] leading-snug">
            <div className="font-medium text-dark-50">
                Estimated turn cost (OpenAI API rates)
            </div>
            <div className="grid grid-cols-[auto_1fr_auto] gap-x-2 gap-y-0.5 tabular-nums">
                <span className="text-dark-300">Input</span>
                <span className="text-dark-200">
                    {formatTokenCount(inputTokens)} tok ×{" "}
                    {formatRate(cost.effectiveInputRate)}
                </span>
                <span className="text-right text-dark-100">
                    {formatCostUsd(cost.inputUsd)}
                </span>

                <span className="text-dark-300">Output</span>
                <span className="text-dark-200">
                    {formatTokenCount(outputTokens)} tok ×{" "}
                    {formatRate(cost.effectiveOutputRate)}
                </span>
                <span className="text-right text-dark-100">
                    {formatCostUsd(cost.outputUsd)}
                </span>

                {reasoningTokens != null && reasoningTokens > 0 && (
                    <>
                        <span className="text-dark-400">↳ reasoning</span>
                        <span className="col-span-2 text-dark-400">
                            {formatTokenCount(reasoningTokens)} tok (incl. in
                            output)
                        </span>
                    </>
                )}

                <span className="col-span-2 mt-0.5 border-t border-dark-700 pt-1 text-dark-200">
                    Total
                </span>
                <span className="mt-0.5 border-t border-dark-700 pt-1 text-right font-medium text-dark-50">
                    {formatCostUsd(cost.totalUsd)}
                </span>
            </div>
            {cost.longContextApplied && (
                <div className="text-dark-300">
                    Long-context multiplier applied (&gt;272K input tokens).
                </div>
            )}
            <div className="text-dark-400">
                Approximation based on {model.displayName} standard tier.
            </div>
        </div>
    );
}

function formatRate(usdPerMTok: number): string {
    return (
        "$" +
        usdPerMTok.toLocaleString("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }) +
        "/MTok"
    );
}
