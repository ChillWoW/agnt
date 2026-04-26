import {
    PlugsIcon,
    UserCircleIcon,
    WarningCircleIcon
} from "@phosphor-icons/react";
import { useAuthStore } from "@/features/auth";
import { Button } from "@/components/ui";
import { SettingHeader } from "./SettingHeader";

function formatDate(value: string | null) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString();
}

function MetaItem({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex flex-col gap-1">
            <span className="text-[11px] font-medium uppercase tracking-wide text-dark-400">
                {label}
            </span>
            <span className="text-[13px] text-dark-100">{value}</span>
        </div>
    );
}

export function CodexSettings() {
    const {
        auth,
        isLoading,
        isConnecting,
        isDisconnecting,
        error,
        connect,
        disconnect
    } = useAuthStore();

    const isConnected = Boolean(auth?.connected);
    const isBusy = isLoading || isConnecting || isDisconnecting;

    return (
        <div className="mx-auto w-full max-w-2xl px-10 pt-14 pb-16">
            <SettingHeader
                title="Codex"
                description="Connect your OpenAI Codex account to enable AI responses in conversations."
            />

            <div className="flex flex-col gap-4">
                {isConnected ? (
                    <div className="overflow-hidden rounded-lg border border-dark-700 bg-dark-900">
                        <div className="flex items-center justify-between gap-4 px-5 py-5">
                            <div className="flex min-w-0 items-center gap-3">
                                <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-dark-800 text-dark-100">
                                    <UserCircleIcon
                                        size={22}
                                        weight="duotone"
                                    />
                                </div>
                                <div className="flex min-w-0 flex-col">
                                    <span className="truncate text-sm font-medium text-dark-50">
                                        {auth?.email ?? "Codex account"}
                                    </span>
                                    {auth?.accountId && (
                                        <span className="truncate font-mono text-[11px] text-dark-300">
                                            {auth.accountId}
                                        </span>
                                    )}
                                </div>
                            </div>
                            <Button
                                variant="danger"
                                size="sm"
                                disabled={isBusy}
                                onClick={() => void disconnect()}
                            >
                                {isDisconnecting
                                    ? "Disconnecting…"
                                    : "Disconnect"}
                            </Button>
                        </div>

                        <div className="grid grid-cols-2 gap-px border-t border-dark-700 bg-dark-700">
                            <div className="bg-dark-900 px-5 py-4">
                                <MetaItem
                                    label="Token expires"
                                    value={formatDate(auth?.expires ?? null)}
                                />
                            </div>
                            <div className="bg-dark-900 px-5 py-4">
                                <MetaItem
                                    label="Connected at"
                                    value={formatDate(
                                        auth?.connectedAt ?? null
                                    )}
                                />
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="flex items-center justify-between gap-4 rounded-lg border border-dark-700 bg-dark-900 px-5 py-5">
                        <div className="flex min-w-0 items-center gap-3">
                            <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-dark-800 text-dark-200">
                                <PlugsIcon size={20} weight="duotone" />
                            </div>
                            <div className="flex min-w-0 flex-col">
                                <span className="text-sm font-medium text-dark-100">
                                    Not connected
                                </span>
                                <span className="text-[12px] text-dark-300">
                                    Sign in with your OpenAI account to start using Codex.
                                </span>
                            </div>
                        </div>
                        <Button
                            variant="primary"
                            size="sm"
                            disabled={isBusy}
                            loading={isConnecting}
                            onClick={() => void connect()}
                        >
                            {isConnecting ? "Connecting…" : "Connect"}
                        </Button>
                    </div>
                )}

                {error && (
                    <div className="flex items-center gap-2 rounded-md border border-red-900 bg-red-950 px-4 py-3">
                        <WarningCircleIcon
                            size={14}
                            weight="duotone"
                            className="shrink-0 text-red-400"
                        />
                        <span className="text-[13px] text-red-300">{error}</span>
                    </div>
                )}
            </div>
        </div>
    );
}
