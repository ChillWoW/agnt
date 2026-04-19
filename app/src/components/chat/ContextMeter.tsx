import { useCallback, useState } from "react";
import { Popover as Base } from "@base-ui/react";
import { compactConversation, useContextMeter } from "@/features/context";
import { useConversationStore } from "@/features/conversations";
import type { PendingAttachment } from "@/features/attachments";
import { cn } from "@/lib/cn";

interface ContextMeterProps {
    workspaceId: string | null | undefined;
    conversationId: string | null | undefined;
    draft: string;
    pendingAttachments?: PendingAttachment[];
    disabled?: boolean;
}

const SIZE = 18;
const VIEW = 20;
const RADIUS = 8;
const STROKE = 3;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function formatInt(n: number): string {
    if (!Number.isFinite(n)) return "0";
    return Math.round(n).toLocaleString();
}

function formatPercent(p: number): string {
    return `${(p * 100).toFixed(p < 0.1 ? 1 : 0)}%`;
}

interface TierStyle {
    stroke: string;
    pulse: boolean;
}

function tierFor(percent: number): TierStyle {
    if (percent >= 0.95) return { stroke: "#ef4444", pulse: true };
    if (percent >= 0.85) return { stroke: "#fb923c", pulse: false };
    if (percent >= 0.6) return { stroke: "#facc15", pulse: false };
    return { stroke: "#9ca3af", pulse: false };
}

export function ContextMeter({
    workspaceId,
    conversationId,
    draft,
    pendingAttachments,
    disabled
}: ContextMeterProps) {
    const meter = useContextMeter({
        workspaceId,
        conversationId,
        draft,
        pendingAttachments
    });
    const bumpContextRefresh = useConversationStore(
        (state) => state.bumpContextRefresh
    );
    const setContextSummary = useConversationStore(
        (state) => state.setContextSummary
    );

    const [open, setOpen] = useState(false);
    const [isCompacting, setIsCompacting] = useState(false);
    const [compactError, setCompactError] = useState<string | null>(null);

    const active = !!workspaceId && !!conversationId;
    const summary = meter.summary;

    const percentClamped = Math.min(1, Math.max(0, meter.projectedPercent));
    const tier = tierFor(percentClamped);
    const offset = CIRCUMFERENCE * (1 - percentClamped);
    const needsAttention = percentClamped >= 0.85;

    const handleCompact = useCallback(async () => {
        if (!workspaceId || !conversationId) return;
        setIsCompacting(true);
        setCompactError(null);
        try {
            const result = await compactConversation(
                workspaceId,
                conversationId
            );
            setContextSummary(conversationId, result.context);
            bumpContextRefresh(conversationId);
            setOpen(false);
        } catch (error) {
            setCompactError(
                error instanceof Error ? error.message : "Compaction failed"
            );
        } finally {
            setIsCompacting(false);
        }
    }, [workspaceId, conversationId, setContextSummary, bumpContextRefresh]);

    if (!active || disabled) {
        return null;
    }

    const tooltipLabel = summary
        ? `${formatPercent(percentClamped)} of ${formatInt(summary.contextWindow)} tokens used`
        : "Loading context";

    return (
        <Base.Root open={open} onOpenChange={setOpen}>
            <Base.Trigger
                aria-label={tooltipLabel}
                className={cn(
                    "group relative flex size-7 shrink-0 items-center justify-center rounded-md text-dark-100 transition-colors outline-none",
                    "hover:bg-dark-800"
                )}
            >
                <svg
                    width={SIZE}
                    height={SIZE}
                    viewBox={`0 0 ${VIEW} ${VIEW}`}
                    className={cn(tier.pulse && "animate-pulse")}
                    aria-hidden="true"
                >
                    <circle
                        cx={VIEW / 2}
                        cy={VIEW / 2}
                        r={RADIUS}
                        fill="none"
                        stroke="currentColor"
                        strokeOpacity="0.25"
                        strokeWidth={STROKE}
                    />
                    <circle
                        cx={VIEW / 2}
                        cy={VIEW / 2}
                        r={RADIUS}
                        fill="none"
                        stroke={tier.stroke}
                        strokeWidth={STROKE}
                        strokeLinecap="butt"
                        strokeDasharray={CIRCUMFERENCE}
                        strokeDashoffset={offset}
                        transform={`rotate(-90 ${VIEW / 2} ${VIEW / 2})`}
                        style={{
                            transition:
                                "stroke-dashoffset 200ms ease, stroke 200ms ease"
                        }}
                    />
                </svg>
            </Base.Trigger>
            <Base.Portal>
                <Base.Positioner
                    side="top"
                    align="end"
                    sideOffset={8}
                    className="z-50"
                >
                    <Base.Popup
                        className={cn(
                            "w-72 rounded-md border border-dark-600 bg-dark-850 p-3 text-dark-50 shadow-lg outline-none",
                            "animate-in fade-in-0 zoom-in-95 duration-150",
                            "data-[ending-style]:animate-out data-[ending-style]:fade-out-0 data-[ending-style]:zoom-out-95"
                        )}
                    >
                        {summary ? (
                            <ContextMeterBody
                                summary={summary}
                                draftTokens={meter.draftTokens}
                                pendingAttachmentTokens={
                                    meter.pendingAttachmentTokens
                                }
                                projectedUsed={meter.projectedUsed}
                                percent={percentClamped}
                                needsAttention={needsAttention}
                                isCompacting={isCompacting}
                                compactError={compactError}
                                onCompact={handleCompact}
                            />
                        ) : (
                            <div className="text-xs text-dark-200">
                                Loading context…
                            </div>
                        )}
                    </Base.Popup>
                </Base.Positioner>
            </Base.Portal>
        </Base.Root>
    );
}

interface BodyProps {
    summary: NonNullable<ReturnType<typeof useContextMeter>["summary"]>;
    draftTokens: number;
    pendingAttachmentTokens: number;
    projectedUsed: number;
    percent: number;
    needsAttention: boolean;
    isCompacting: boolean;
    compactError: string | null;
    onCompact: () => void;
}

function ContextMeterBody({
    summary,
    draftTokens,
    pendingAttachmentTokens,
    projectedUsed,
    percent,
    needsAttention,
    compactError
}: BodyProps) {
    const headline = `${formatInt(projectedUsed)} / ${formatInt(summary.contextWindow)}`;
    const headlinePercent = formatPercent(percent);

    return (
        <div className="flex flex-col gap-2 text-xs">
            <div>
                <div className="text-[11px] uppercase tracking-wide text-dark-200">
                    {summary.modelDisplayName}
                </div>
                <div className="mt-0.5 flex items-baseline gap-1.5 text-dark-50">
                    <span className="text-xs">{headline}</span>
                    <span
                        className={cn(
                            "text-xs font-medium",
                            percent >= 0.95
                                ? "text-red-400"
                                : percent >= 0.85
                                  ? "text-orange-400"
                                  : percent >= 0.6
                                    ? "text-yellow-400"
                                    : "text-dark-200"
                        )}
                    >
                        {headlinePercent}
                    </span>
                </div>
            </div>

            <div className="h-px bg-dark-700" />

            <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-[11px]">
                <Row label="History" value={summary.breakdown.messages} />
                <Row
                    label="Reasoning"
                    value={summary.breakdown.reasoning}
                    hint="Not resent to the model"
                />
                <Row
                    label="Tool output"
                    value={summary.breakdown.toolOutputs}
                />
                <Row
                    label="Attachments"
                    value={summary.breakdown.attachments}
                />
                <Row
                    label="Repo instructions"
                    value={summary.breakdown.repoInstructions}
                />
                <Row
                    label="System"
                    value={summary.breakdown.systemInstructions}
                />
{draftTokens > 0 && (
                    <Row label="Draft" value={draftTokens} accent />
                )}
                {pendingAttachmentTokens > 0 && (
                    <Row
                        label="Pending attachments"
                        value={pendingAttachmentTokens}
                        accent
                    />
                )}
            </dl>

            {summary.compactedMessageCount > 0 && (
                <div className="rounded-sm bg-dark-800 px-2 py-1 text-[11px] text-dark-200">
                    {summary.compactedMessageCount} older{" "}
                    {summary.compactedMessageCount === 1
                        ? "message"
                        : "messages"}{" "}
                    already compacted
                </div>
            )}

            {compactError && (
                <div className="rounded-sm bg-red-500/15 px-2 py-1 text-[11px] text-red-400">
                    {compactError}
                </div>
            )}

            {needsAttention && !compactError && (
                <div className="mt-2 text-[11px] text-orange-400">
                    Next send will auto-compact above{" "}
                    {formatPercent(summary.autoCompactThreshold)}.
                </div>
            )}
        </div>
    );
}

interface RowProps {
    label: string;
    value: number;
    muted?: boolean;
    accent?: boolean;
    hint?: string;
}

function Row({ label, value, accent, hint }: RowProps) {
    return (
        <>
            <dt
                className={cn("text-dark-200", accent && "text-dark-50")}
                title={hint}
            >
                {label}
            </dt>
            <dd className={cn("text-right", accent && "text-dark-50")}>
                {formatInt(value)}
            </dd>
        </>
    );
}
