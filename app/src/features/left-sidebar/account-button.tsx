import { useCallback, useEffect, useMemo, useState } from "react";
import { UserCircleIcon } from "@phosphor-icons/react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui";
import { useAuthStore } from "@/features/auth";
import { authApi } from "@/features/auth/auth-api";
import { cn } from "@/lib/cn";

type RateLimitWindow = {
    used_percent: number;
    limit_window_seconds: number;
    reset_after_seconds: number;
    reset_at: number;
};

type RateLimitBlock = {
    allowed: boolean;
    limit_reached: boolean;
    primary_window: RateLimitWindow;
    secondary_window?: RateLimitWindow;
};

type AdditionalRateLimit = {
    limit_name: string;
    rate_limit: {
        allowed: boolean;
        limit_reached: boolean;
        primary_window: RateLimitWindow;
    };
};

type RateLimitsData = {
    plan_type: string;
    rate_limit: RateLimitBlock;
    additional_rate_limits?: AdditionalRateLimit[];
    credits?: {
        has_credits: boolean;
        unlimited: boolean;
        balance: string;
    };
};

type WindowRow = {
    label: string;
    remainingPct: number;
    reset: string;
};

function windowLabel(seconds: number) {
    if (seconds <= 1800) return `${seconds / 60}m`;
    if (seconds < 86400) return `${seconds / 3600}h`;
    if (seconds < 604800) return "Daily";
    if (seconds < 2592000) return "Weekly";
    return "Monthly";
}

function formatReset(resetAfterSeconds: number, limitWindowSeconds: number) {
    if (resetAfterSeconds <= 0) return "now";

    const date = new Date(Date.now() + resetAfterSeconds * 1000);

    if (limitWindowSeconds >= 604800) {
        return date.toLocaleString(undefined, {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit"
        });
    }

    if (resetAfterSeconds < 86400) {
        return date.toLocaleTimeString(undefined, {
            hour: "numeric",
            minute: "2-digit"
        });
    }

    return date.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric"
    });
}

function prettifyPlan(planType: string | null | undefined) {
    if (!planType) return "Plan unavailable";

    return planType
        .split(/[_\s-]+/)
        .filter(Boolean)
        .map((part) => part[0]?.toUpperCase() + part.slice(1).toLowerCase())
        .join(" ");
}

function remainingTextColor(pct: number) {
    if (pct <= 15) return "text-red-400";
    if (pct <= 35) return "text-amber-400";
    return "text-dark-100";
}

function remainingBarColor(pct: number) {
    if (pct <= 15) return "bg-red-500/70";
    if (pct <= 35) return "bg-amber-600";
    return "bg-primary-500";
}

function collectRows(data: RateLimitsData): WindowRow[] {
    const rows: WindowRow[] = [];

    const pushRow = (label: string, window: RateLimitWindow) => {
        rows.push({
            label,
            remainingPct: Math.max(
                0,
                Math.min(100, Math.round(100 - window.used_percent))
            ),
            reset: formatReset(
                window.reset_after_seconds,
                window.limit_window_seconds
            )
        });
    };

    pushRow(
        windowLabel(data.rate_limit.primary_window.limit_window_seconds),
        data.rate_limit.primary_window
    );

    if (data.rate_limit.secondary_window) {
        pushRow(
            windowLabel(data.rate_limit.secondary_window.limit_window_seconds),
            data.rate_limit.secondary_window
        );
    }

    for (const extra of data.additional_rate_limits ?? []) {
        pushRow(
            extra.limit_name.replace(/_/g, " "),
            extra.rate_limit.primary_window
        );
    }

    return rows;
}

function getDisplayName(email: string | null, accountId: string | null) {
    if (email) {
        return email.split("@")[0] || email;
    }
    if (accountId) {
        return accountId.slice(0, 10);
    }
    return "Account";
}

export function AccountButton() {
    const auth = useAuthStore((state) => state.auth);
    const [open, setOpen] = useState(false);
    const [rateLimits, setRateLimits] = useState<RateLimitsData | null>(null);

    const fetchRateLimits = useCallback(async () => {
        if (!auth?.connected) {
            setRateLimits(null);
            return;
        }
        try {
            const result = await authApi.getRateLimits();
            setRateLimits(result);
        } catch {
            setRateLimits(null);
        }
    }, [auth?.connected]);

    useEffect(() => {
        void fetchRateLimits();

        if (!auth?.connected) return;

        const intervalId = window.setInterval(() => {
            void fetchRateLimits();
        }, 60000);

        return () => window.clearInterval(intervalId);
    }, [auth?.connected, fetchRateLimits]);

    const displayName = getDisplayName(
        auth?.email ?? null,
        auth?.accountId ?? null
    );
    const planLabel = auth?.connected
        ? prettifyPlan(rateLimits?.plan_type ?? "connected")
        : "Not connected";

    const rows = useMemo(
        () => (rateLimits ? collectRows(rateLimits) : []),
        [rateLimits]
    );

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger className="group flex w-full shrink-0 items-center gap-2 rounded-md px-2.5 max-h-10 min-h-10 text-left transition-colors hover:bg-dark-850">
                <UserCircleIcon
                    className={cn(
                        "size-5.5 shrink-0 transition-colors",
                        auth?.connected
                            ? "text-dark-100 group-hover:text-dark-50"
                            : "text-dark-300"
                    )}
                    weight={auth?.connected ? "fill" : "regular"}
                />
                <div className="flex min-w-0 flex-1 flex-col leading-tight">
                    <span className="truncate text-xs font-medium text-dark-100 group-hover:text-dark-50">
                        {displayName}
                    </span>
                    <span className="truncate text-[11px] text-dark-200">
                        {auth?.connected
                            ? `${planLabel} plan`
                            : "Not connected"}
                    </span>
                </div>
            </PopoverTrigger>

            <PopoverContent
                side="top"
                sideOffset={12}
                className="w-60 overflow-hidden p-0"
            >
                <div className="p-2.5">
                    <p className="truncate text-xs font-medium text-dark-50">
                        {displayName}
                    </p>
                    {auth?.email && (
                        <p className="mt-0.5 truncate text-[11px] text-dark-200">
                            {auth.email}
                        </p>
                    )}
                </div>

                {rows.length > 0 && (
                    <div className="space-y-2 border-t border-dark-600 p-2.5">
                        <p className="text-xs font-medium uppercase text-dark-200">
                            Rate limits
                        </p>

                        {rows.map((row) => (
                            <div
                                key={`${row.label}-${row.reset}`}
                                className="space-y-1"
                            >
                                <div className="flex items-baseline justify-between">
                                    <span className="text-xs capitalize text-dark-100">
                                        {row.label}
                                    </span>
                                    <span
                                        className={cn(
                                            "text-xs",
                                            remainingTextColor(row.remainingPct)
                                        )}
                                    >
                                        {row.remainingPct}%
                                    </span>
                                </div>
                                <div className="h-1 w-full overflow-hidden rounded-full bg-dark-700">
                                    <div
                                        className={cn(
                                            "h-full rounded-full transition-all duration-500",
                                            remainingBarColor(row.remainingPct)
                                        )}
                                        style={{
                                            width: `${row.remainingPct}%`
                                        }}
                                    />
                                </div>
                                <p className="text-[10px] text-dark-300">
                                    Resets {row.reset}
                                </p>
                            </div>
                        ))}
                    </div>
                )}

                {rateLimits?.credits &&
                    !rateLimits.credits.unlimited &&
                    rateLimits.credits.has_credits && (
                        <div className="flex items-center justify-between border-t border-dark-700 px-3 py-2">
                            <span className="text-xs text-dark-200">
                                Credits
                            </span>
                            <span className="text-xs font-medium tabular-nums text-dark-50">
                                ${rateLimits.credits.balance}
                            </span>
                        </div>
                    )}

                {!auth?.connected && (
                    <div className="border-t border-dark-700 px-3 py-2.5">
                        <p className="text-xs text-dark-200">
                            Connect Codex in Settings to see limits.
                        </p>
                    </div>
                )}
            </PopoverContent>
        </Popover>
    );
}
