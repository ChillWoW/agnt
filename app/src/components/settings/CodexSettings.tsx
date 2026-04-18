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

function MetaItem({
    label,
    value,
    mono
}: {
    label: string;
    value: string;
    mono?: boolean;
}) {
    return (
        <div className="flex flex-col gap-0.5">
            <span className="text-[10px] font-medium text-dark-300">
                {label}
            </span>
            <span className="text-xs text-dark-200">{value}</span>
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
        <div className="mx-auto w-full max-w-xl p-8">
            <SettingHeader
                title="Codex"
                description="Connect your OpenAI Codex account to enable AI responses in conversations."
            />

            <div className="flex flex-col gap-3">
                {isConnected ? (
                    <div className="rounded-md border border-dark-700 bg-dark-900 overflow-hidden">
                        <div className="flex items-start justify-between gap-4 p-4">
                            <div className="flex items-center gap-3">
                                <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-dark-800 text-dark-300">
                                    <UserCircleIcon
                                        size={20}
                                        weight="duotone"
                                    />
                                </div>
                                <div className="flex flex-col gap-0.5">
                                    <span className="text-[13px] font-medium text-dark-50">
                                        {auth?.email ?? "Codex account"}
                                    </span>
                                    {auth?.accountId && (
                                        <span className="text-[11px] text-dark-300">
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
                                    ? "Disconnecting..."
                                    : "Disconnect"}
                            </Button>
                        </div>

                        <div className="grid grid-cols-2 gap-px border-t border-dark-700 bg-dark-700">
                            <div className="bg-dark-900 px-4 py-3">
                                <MetaItem
                                    label="Token expires"
                                    value={formatDate(auth?.expires ?? null)}
                                />
                            </div>
                            <div className="bg-dark-900 px-4 py-3">
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
                    <div className="flex flex-col items-center gap-4 rounded-md border border-dark-700 bg-dark-900 py-10">
                        <div className="flex size-10 items-center justify-center rounded-full bg-dark-800 text-dark-400">
                            <PlugsIcon size={20} weight="duotone" />
                        </div>
                        <div className="flex flex-col items-center gap-1 text-center">
                            <span className="text-[13px] font-medium text-dark-100">
                                Not connected
                            </span>
                            <span className="max-w-xs text-xs text-dark-400">
                                Opens OpenAI in your browser and stores the
                                session locally at{" "}
                                <code className="text-dark-300">
                                    ~/.agnt/auth.json
                                </code>
                            </span>
                        </div>
                        <Button
                            variant="primary"
                            size="sm"
                            disabled={isBusy}
                            loading={isConnecting}
                            onClick={() => void connect()}
                        >
                            {isConnecting ? "Connecting..." : "Connect Codex"}
                        </Button>
                    </div>
                )}

                {error && (
                    <div className="flex items-center gap-2 rounded-md border border-red-500/25 bg-red-500/10 px-3 py-2.5">
                        <WarningCircleIcon
                            size={14}
                            weight="duotone"
                            className="shrink-0 text-red-400"
                        />
                        <span className="text-xs text-red-300">{error}</span>
                    </div>
                )}
            </div>
        </div>
    );
}
