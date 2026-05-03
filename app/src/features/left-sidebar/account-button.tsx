import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    CheckIcon,
    PlusIcon,
    SignOutIcon,
    UserCircleIcon,
    UserPlusIcon
} from "@phosphor-icons/react";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
    Tooltip,
    toast
} from "@/components/ui";
import {
    accountAvatarStyle,
    accountInitial,
    selectActiveAccount,
    useAuthStore
} from "@/features/auth";
import { authApi } from "@/features/auth/auth-api";
import type { AuthAccount } from "@/features/auth";
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

function getDisplayName(account: AuthAccount | null) {
    if (!account) return "Account";
    if (account.label && account.label.trim().length > 0) {
        return account.label.trim();
    }
    if (account.name && account.name.trim().length > 0) {
        return account.name.trim();
    }
    if (account.email) {
        return account.email.split("@")[0] || account.email;
    }
    return account.accountId.slice(0, 10);
}

/** Secondary line under the display name in popover/settings rows. */
function getSecondaryLine(account: AuthAccount): string | null {
    // If the primary line is the label or name, surface the email next.
    const primaryIsCustom =
        Boolean(account.label && account.label.trim().length > 0) ||
        Boolean(account.name && account.name.trim().length > 0);
    if (primaryIsCustom && account.email) {
        return account.email;
    }
    if (!primaryIsCustom && account.email) {
        // Primary is already the email-prefix; show the full email here.
        return account.email;
    }
    return `id ${account.accountId.slice(0, 12)}`;
}

function AccountAvatar({
    account,
    size = 28
}: {
    account: AuthAccount;
    size?: number;
}) {
    const seed = account.accountId || account.email || "";
    const style = accountAvatarStyle(seed);
    const initial = accountInitial({
        name: account.name,
        email: account.email,
        label: account.label,
        accountId: account.accountId
    });

    return (
        <div
            className="flex shrink-0 items-center justify-center rounded-full font-semibold leading-none"
            style={{
                width: size,
                height: size,
                fontSize: Math.max(10, Math.round(size * 0.42)),
                ...style
            }}
            aria-hidden
        >
            {initial}
        </div>
    );
}

function AccountRow({
    account,
    isActive,
    onActivate,
    onDisconnect
}: {
    account: AuthAccount;
    isActive: boolean;
    onActivate: () => void;
    onDisconnect: () => void;
}) {
    const display = getDisplayName(account);
    const subtitle = getSecondaryLine(account);

    return (
        <div
            className={cn(
                "group relative flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors",
                isActive ? "bg-primary-500/10" : "hover:bg-dark-700"
            )}
        >
            {isActive && (
                <span
                    aria-hidden
                    className="absolute inset-y-1 left-0 w-[2px] rounded-full bg-primary-500"
                />
            )}
            <button
                type="button"
                onClick={onActivate}
                disabled={isActive}
                className={cn(
                    "flex min-w-0 flex-1 items-center gap-2.5 text-left",
                    isActive ? "cursor-default" : "cursor-pointer"
                )}
            >
                <AccountAvatar account={account} />
                <div className="min-w-0 flex-1 leading-tight">
                    <div className="flex items-center gap-1.5">
                        <span className="truncate text-xs font-medium text-dark-50">
                            {display}
                        </span>
                        {isActive && (
                            <CheckIcon
                                className="size-3 shrink-0 text-primary-400"
                                weight="bold"
                            />
                        )}
                    </div>
                    {subtitle && (
                        <span className="block truncate text-[11px] text-dark-300">
                            {subtitle}
                        </span>
                    )}
                </div>
            </button>

            <Tooltip content="Disconnect" side="left">
                <button
                    type="button"
                    onClick={(event) => {
                        event.stopPropagation();
                        onDisconnect();
                    }}
                    aria-label={`Disconnect ${display}`}
                    className={cn(
                        "flex size-6 shrink-0 items-center justify-center rounded-md text-dark-300 transition-opacity",
                        "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
                        "hover:bg-dark-600 hover:text-red-300"
                    )}
                >
                    <SignOutIcon className="size-3.5" weight="bold" />
                </button>
            </Tooltip>
        </div>
    );
}

export function AccountButton() {
    const accounts = useAuthStore((state) => state.accounts);
    const activeAccountId = useAuthStore((state) => state.activeAccountId);
    const isConnecting = useAuthStore((state) => state.isConnecting);
    const addAccount = useAuthStore((state) => state.addAccount);
    const setActive = useAuthStore((state) => state.setActive);
    const removeAccount = useAuthStore((state) => state.removeAccount);

    const activeAccount = useMemo(
        () => selectActiveAccount({ accounts, activeAccountId }),
        [accounts, activeAccountId]
    );

    const [open, setOpen] = useState(false);
    const [rateLimits, setRateLimits] = useState<RateLimitsData | null>(null);
    const lastRateLimitsAccountIdRef = useRef<string | null>(null);

    const fetchRateLimits = useCallback(async () => {
        if (!activeAccount) {
            setRateLimits(null);
            lastRateLimitsAccountIdRef.current = null;
            return;
        }

        try {
            const result = await authApi.getRateLimits(activeAccount.accountId);
            setRateLimits(result);
            lastRateLimitsAccountIdRef.current = activeAccount.accountId;
        } catch {
            setRateLimits(null);
        }
    }, [activeAccount]);

    useEffect(() => {
        // Drop stale rate limits the moment the active account changes; the
        // background poll will fill in fresh ones.
        if (
            activeAccount?.accountId !== lastRateLimitsAccountIdRef.current
        ) {
            setRateLimits(null);
        }

        void fetchRateLimits();

        if (!activeAccount) return;

        const intervalId = window.setInterval(() => {
            void fetchRateLimits();
        }, 60000);

        return () => window.clearInterval(intervalId);
    }, [activeAccount, fetchRateLimits]);

    const displayName = getDisplayName(activeAccount);
    const planLabel = activeAccount
        ? prettifyPlan(rateLimits?.plan_type ?? "connected")
        : "Not connected";

    const rows = useMemo(
        () => (rateLimits ? collectRows(rateLimits) : []),
        [rateLimits]
    );

    const handleSwitch = useCallback(
        async (accountId: string) => {
            if (accountId === activeAccountId) return;
            const previousActive = activeAccountId;
            const target = accounts.find((a) => a.accountId === accountId);
            const ok = await setActive(accountId);
            if (ok && target) {
                toast.success({
                    title: `Switched to ${getDisplayName(target)}`,
                    description: target.email ?? undefined,
                    action: previousActive
                        ? {
                              label: "Undo",
                              onClick: () => void setActive(previousActive)
                          }
                        : undefined
                });
            }
        },
        [accounts, activeAccountId, setActive]
    );

    const handleDisconnect = useCallback(
        async (account: AuthAccount) => {
            const display = getDisplayName(account);
            const ok = await removeAccount(account.accountId);
            if (ok) {
                toast.success({
                    title: `Disconnected ${display}`,
                    description: account.email ?? undefined
                });
            }
        },
        [removeAccount]
    );

    const handleAddAccount = useCallback(async () => {
        if (isConnecting) return;
        const result = await addAccount();
        if (result.ok) {
            const newAccount =
                useAuthStore
                    .getState()
                    .accounts.find(
                        (a) => a.accountId === result.accountId
                    ) ?? null;
            toast.success({
                title: newAccount
                    ? `Connected ${getDisplayName(newAccount)}`
                    : "Codex account connected",
                description: newAccount?.email ?? undefined
            });
        } else if (result.error) {
            toast.error({
                title: "Connection failed",
                description: result.error
            });
        }
    }, [addAccount, isConnecting]);

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger className="group flex w-full shrink-0 items-center gap-2 rounded-md px-2.5 max-h-10 min-h-10 text-left transition-colors hover:bg-dark-850">
                {activeAccount ? (
                    <AccountAvatar account={activeAccount} size={22} />
                ) : (
                    <UserCircleIcon
                        className="size-5.5 shrink-0 text-dark-300"
                        weight="regular"
                    />
                )}
                <div className="flex min-w-0 flex-1 flex-col leading-tight">
                    <span className="truncate text-xs font-medium text-dark-100 group-hover:text-dark-50">
                        {displayName}
                    </span>
                    <span className="truncate text-[11px] text-dark-200">
                        {activeAccount
                            ? `${planLabel} plan`
                            : "Not connected"}
                    </span>
                </div>
            </PopoverTrigger>

            <PopoverContent
                side="top"
                sideOffset={12}
                className="flex w-72 max-h-[calc(100vh-120px)] flex-col overflow-hidden p-0"
            >
                <div className="min-h-0 flex-1 overflow-y-auto">
                {activeAccount ? (
                    <div className="flex items-center gap-2.5 p-3">
                        <AccountAvatar account={activeAccount} size={36} />
                        <div className="min-w-0 flex-1 leading-tight">
                            <p className="truncate text-sm font-medium text-dark-50">
                                {displayName}
                            </p>
                            {activeAccount.email && (
                                <p className="mt-0.5 truncate text-[11px] text-dark-200">
                                    {activeAccount.email}
                                </p>
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="p-3">
                        <p className="text-sm font-medium text-dark-50">
                            No account connected
                        </p>
                        <p className="mt-0.5 text-[11px] text-dark-300">
                            Connect an OpenAI Codex account to start
                            generating.
                        </p>
                    </div>
                )}

                {rows.length > 0 && (
                    <div className="space-y-2 border-t border-dark-700 p-3">
                        <p className="text-[10px] font-medium uppercase tracking-wide text-dark-300">
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

                {accounts.length > 0 && (
                    <div className="flex flex-col gap-0.5 border-t border-dark-700 p-2">
                        <p className="px-2 pb-1 pt-1 text-[10px] font-medium uppercase tracking-wide text-dark-300">
                            Accounts ({accounts.length})
                        </p>
                        {accounts.map((account) => (
                            <AccountRow
                                key={account.accountId}
                                account={account}
                                isActive={
                                    account.accountId === activeAccountId
                                }
                                onActivate={() =>
                                    void handleSwitch(account.accountId)
                                }
                                onDisconnect={() =>
                                    void handleDisconnect(account)
                                }
                            />
                        ))}
                    </div>
                )}
                </div>

                <div className="shrink-0 border-t border-dark-700 p-2">
                    <button
                        type="button"
                        onClick={handleAddAccount}
                        disabled={isConnecting}
                        className={cn(
                            "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs font-medium transition-colors",
                            "text-dark-50 hover:bg-dark-700 disabled:cursor-progress disabled:opacity-70"
                        )}
                    >
                        {isConnecting ? (
                            <PlusIcon
                                className="size-4 animate-spin text-dark-200"
                                weight="bold"
                            />
                        ) : (
                            <UserPlusIcon
                                className="size-4 text-dark-200"
                                weight="bold"
                            />
                        )}
                        <span>
                            {accounts.length === 0
                                ? "Connect Codex account"
                                : isConnecting
                                  ? "Waiting for browser…"
                                  : "Add another account"}
                        </span>
                    </button>
                </div>
            </PopoverContent>
        </Popover>
    );
}
