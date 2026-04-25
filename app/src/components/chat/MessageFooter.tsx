import { useCallback, useEffect, useRef, useState } from "react";
import { CopyIcon, CheckIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { BinaryMatrix } from "@/features/left-sidebar/binary-matrix";
import { Tooltip } from "@/components/ui";
import type { Message } from "@/features/conversations/conversation-types";
import { usePermissionStore } from "@/features/permissions";
import { useQuestionStore } from "@/features/questions";
import { getCachedModels } from "@/features/models";

function formatDurationSeconds(durationMs: number): string {
    const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
    return totalSeconds + "s";
}

function formatModelLabel(modelId: string): string {
    const models = getCachedModels();
    const match = models?.find((m) => m.id === modelId);
    return match?.displayName ?? modelId;
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
}

export function MessageFooter({ message }: MessageFooterProps) {
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
        } catch {
            // clipboard may be unavailable; fail silently
        }
    }, [message.content]);

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

    if (!hasDuration && !hasModel && !message.content) {
        return null;
    }

    return (
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-dark-300">
            {hasDuration && (
                <span>{formatDurationSeconds(durationMs as number)}</span>
            )}
            {hasModel && hasDuration && (
                <span className="text-dark-400">-</span>
            )}
            {hasModel && (
                <span>{formatModelLabel(message.model_id as string)}</span>
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
                        className={cn(
                            "ml-0.5 flex size-5.5 items-center justify-center rounded text-dark-300 transition-opacity hover:bg-dark-800 hover:text-dark-50",
                            "opacity-0 group-hover/message:opacity-100 focus-visible:opacity-100",
                            copied && "opacity-100"
                        )}
                    >
                        {copied ? (
                            <CheckIcon className="size-3" weight="bold" />
                        ) : (
                            <CopyIcon className="size-3" weight="bold" />
                        )}
                    </button>
                </Tooltip>
            )}
        </div>
    );
}
