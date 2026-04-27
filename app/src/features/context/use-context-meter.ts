import { useCallback, useEffect, useMemo, useState } from "react";
import { useConversationStore } from "@/features/conversations";
import type { PendingAttachment } from "@/features/attachments";
import { fetchContextSummary } from "./context-api";
import { countTokens } from "./context-tokenizer";
import type { ContextSummary } from "./context-types";

interface UseContextMeterArgs {
    workspaceId: string | null | undefined;
    conversationId: string | null | undefined;
    draft: string;
    pendingAttachments?: PendingAttachment[];
}

export interface ContextMeterState {
    summary: ContextSummary | null;
    isLoading: boolean;
    error: Error | null;
    draftTokens: number;
    pendingAttachmentTokens: number;
    projectedUsed: number;
    projectedPercent: number;
    refresh: () => void;
}

/**
 * Live context usage. Server is authoritative for history; we only estimate
 * the unsent draft (textarea contents + pending attachments) locally and
 * add it on top. The hook re-fetches on every `refreshToken` bump — the
 * SSE handler bumps on `user-message`, `tool-result`, `finish`, `abort`,
 * and `compacted` — with a 150ms trailing coalesce so a burst of tool
 * completions doesn't fan out into N HTTP calls. Stale in-flight fetches
 * are aborted via AbortController whenever a newer bump supersedes them.
 */
export function useContextMeter({
    workspaceId,
    conversationId,
    draft,
    pendingAttachments
}: UseContextMeterArgs): ContextMeterState {
    const summary = useConversationStore((state) =>
        conversationId
            ? (state.contextByConversationId[conversationId] ?? null)
            : null
    );
    const refreshToken = useConversationStore((state) =>
        conversationId
            ? (state.contextRefreshTokens[conversationId] ?? 0)
            : 0
    );
    const setContextSummary = useConversationStore(
        (state) => state.setContextSummary
    );
    const bumpContextRefresh = useConversationStore(
        (state) => state.bumpContextRefresh
    );

    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<Error | null>(null);

    useEffect(() => {
        if (!workspaceId || !conversationId) {
            return;
        }

        // The effect re-runs on every `refreshToken` bump emitted from the
        // SSE handler (`user-message`, `tool-result`, `finish`, `abort`,
        // `compacted`). Tool-heavy turns fire several bumps in quick
        // succession (e.g. parallel tool completions); trail by ~150ms so
        // bursts coalesce into a single /context fetch. 150ms is well
        // below the ~250ms "feels instant" threshold so the meter still
        // visibly ticks up as each tool call lands.
        const controller = new AbortController();
        let cancelled = false;
        setError(null);

        const timer = window.setTimeout(() => {
            if (cancelled) return;
            setIsLoading(true);
            fetchContextSummary(workspaceId, conversationId, controller.signal)
                .then((next) => {
                    if (cancelled) return;
                    setContextSummary(conversationId, next);
                })
                .catch((err: unknown) => {
                    if (cancelled) return;
                    if (
                        err instanceof DOMException &&
                        err.name === "AbortError"
                    ) {
                        return;
                    }
                    setError(err instanceof Error ? err : new Error(String(err)));
                })
                .finally(() => {
                    if (cancelled) return;
                    setIsLoading(false);
                });
        }, 150);

        return () => {
            cancelled = true;
            window.clearTimeout(timer);
            controller.abort();
        };
    }, [workspaceId, conversationId, refreshToken, setContextSummary]);

    const refresh = useCallback(() => {
        if (!conversationId) return;
        bumpContextRefresh(conversationId);
    }, [bumpContextRefresh, conversationId]);

    const draftTokens = useMemo(() => {
        if (draft.trim().length === 0) return 0;
        const base = countTokens(draft) + 4;
        const mentionMatches = draft.match(/(?:^|[\s(\[{])@[A-Za-z0-9_./\\-]+\/?/g);
        const mentionCount = mentionMatches?.length ?? 0;
        const mentionOverhead = mentionCount > 0 ? mentionCount * 10 + 40 : 0;
        return base + mentionOverhead;
    }, [draft]);

    const pendingAttachmentTokens = useMemo(() => {
        if (!pendingAttachments || pendingAttachments.length === 0) return 0;
        let total = 0;
        for (const pending of pendingAttachments) {
            if (pending.status !== "ready") continue;
            if (typeof pending.estimated_tokens === "number") {
                total += pending.estimated_tokens;
            }
        }
        return total;
    }, [pendingAttachments]);

    const projectedUsed = summary
        ? summary.usedTokens + draftTokens + pendingAttachmentTokens
        : draftTokens + pendingAttachmentTokens;

    const projectedPercent =
        summary && summary.contextWindow > 0
            ? projectedUsed / summary.contextWindow
            : 0;

    return {
        summary,
        isLoading,
        error,
        draftTokens,
        pendingAttachmentTokens,
        projectedUsed,
        projectedPercent,
        refresh
    };
}
