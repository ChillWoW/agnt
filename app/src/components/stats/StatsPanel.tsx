import { useState } from "react";
import { useGlobalStats } from "@/features/stats";
import { StatCard } from "./StatCard";
import { UsageHeatmap } from "./UsageHeatmap";
import { cn } from "@/lib/cn";

interface StatsPanelProps {
    reloadKey?: string | null;
}

type View = "overview" | "models";

function formatNumber(n: number): string {
    return n.toLocaleString("en-US");
}

function formatTokensShort(n: number): string {
    if (n >= 1_000_000) {
        const v = n / 1_000_000;
        return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)}M`;
    }
    if (n >= 10_000) {
        return `${(n / 1000).toFixed(0)}K`;
    }
    if (n >= 1000) {
        return `${(n / 1000).toFixed(1)}K`;
    }
    return n.toLocaleString("en-US");
}

function formatHour(h: number | null): string {
    if (h === null) return "—";
    const suffix = h >= 12 ? "PM" : "AM";
    const twelve = h % 12 === 0 ? 12 : h % 12;
    return `${twelve} ${suffix}`;
}

function SegmentedTabs<T extends string>({
    value,
    onChange,
    options
}: {
    value: T;
    onChange: (v: T) => void;
    options: { id: T; label: string }[];
}) {
    return (
        <div className="inline-flex items-center rounded-md bg-dark-850/80 p-0.5 border border-dark-700/80">
            {options.map((opt) => (
                <button
                    key={opt.id}
                    onClick={() => onChange(opt.id)}
                    className={cn(
                        "px-2 py-0.5 text-[11px] font-medium rounded-[5px] transition-colors",
                        opt.id === value
                            ? "bg-dark-700 text-dark-50"
                            : "text-dark-300 hover:text-dark-100"
                    )}
                >
                    {opt.label}
                </button>
            ))}
        </div>
    );
}

function ModelsList({
    models
}: {
    models: { id: string; label: string; count: number }[];
}) {
    if (models.length === 0) {
        return (
            <div className="flex items-center justify-center h-[92px] text-[11px] text-dark-300">
                No model usage tracked yet.
            </div>
        );
    }

    const total = models.reduce((s, m) => s + m.count, 0);
    const top = models.slice(0, 6);

    return (
        <div className="flex flex-col gap-1.5 py-1">
            {top.map((m) => {
                const pct = total > 0 ? (m.count / total) * 100 : 0;
                return (
                    <div key={m.id} className="flex flex-col gap-1">
                        <div className="flex items-baseline justify-between gap-2">
                            <span className="text-[11.5px] text-dark-100 truncate">
                                {m.label}
                            </span>
                            <span className="text-[10.5px] tabular-nums text-dark-300 shrink-0">
                                {formatNumber(m.count)} · {pct.toFixed(0)}%
                            </span>
                        </div>
                        <div className="h-1 w-full rounded-full bg-dark-800 overflow-hidden">
                            <div
                                className="h-full rounded-full bg-blue-500"
                                style={{ width: `${Math.max(pct, 1.5)}%` }}
                            />
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

export function StatsPanel({ reloadKey }: StatsPanelProps) {
    const { stats, loading, error } = useGlobalStats(reloadKey);

    const [view, setView] = useState<View>("overview");

    if (loading && !stats) {
        return (
            <div className="w-full rounded-xl border border-dark-700 bg-dark-900/60 p-3 animate-pulse">
                <div className="h-5 w-full rounded bg-dark-800 mb-3" />
                <div className="grid grid-cols-4 gap-1.5 mb-1.5">
                    {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                        <div
                            key={i}
                            className="h-11 rounded-md bg-dark-850/60"
                        />
                    ))}
                </div>
                <div className="h-24 rounded-md bg-dark-850/60 mt-2" />
            </div>
        );
    }

    if (error && !stats) {
        return (
            <div className="w-full rounded-xl border border-dark-700 bg-dark-900/60 px-4 py-6 text-center text-xs text-dark-200">
                Couldn't load stats. Try again in a moment.
            </div>
        );
    }

    if (!stats) return null;

    const isEmpty = stats.totals.userMessages === 0;

    if (isEmpty) {
        return (
            <div className="w-full rounded-xl border border-dashed border-dark-700 bg-dark-900/40 px-5 py-6 text-center">
                <div className="text-sm text-dark-100 font-medium">
                    No activity yet
                </div>
                <div className="mt-1 text-[11.5px] text-dark-300">
                    {stats.workspaceCount === 0
                        ? "Open a workspace and send your first message to start tracking stats."
                        : "Send your first message to start tracking streaks, tokens, and more."}
                </div>
            </div>
        );
    }

    return (
        <div className="w-full rounded-xl border border-dark-700 bg-dark-900/60 p-3">
            <div className="flex items-center justify-between mb-2.5">
                <SegmentedTabs
                    value={view}
                    onChange={setView}
                    options={[
                        { id: "overview", label: "Overview" },
                        { id: "models", label: "Models" }
                    ]}
                />
            </div>

            {view === "overview" ? (
                <div className="grid grid-cols-4 gap-1.5">
                    <StatCard
                        label="Sessions"
                        value={formatNumber(stats.totals.sessions)}
                    />
                    <StatCard
                        label="Messages"
                        value={formatNumber(stats.totals.userMessages)}
                    />
                    <StatCard
                        label="Total tokens"
                        value={formatTokensShort(stats.totals.totalTokens)}
                    />
                    <StatCard
                        label="Active days"
                        value={formatNumber(stats.totals.activeDays)}
                    />
                    <StatCard
                        label="Current streak"
                        value={`${stats.streak.current}d`}
                    />
                    <StatCard
                        label="Longest streak"
                        value={`${stats.streak.longest}d`}
                    />
                    <StatCard
                        label="Peak hour"
                        value={formatHour(stats.mostActiveHour)}
                    />
                    <StatCard
                        label="Favorite model"
                        value={
                            stats.favoriteModel ? (
                                stats.favoriteModel.label
                            ) : (
                                <span className="text-dark-300">—</span>
                            )
                        }
                    />
                </div>
            ) : (
                <div className="rounded-md bg-dark-850/60 px-2.5 py-2">
                    <ModelsList models={stats.models} />
                </div>
            )}

            <div className="mt-2">
                <UsageHeatmap days={stats.heatmap.days} />
            </div>
        </div>
    );
}
