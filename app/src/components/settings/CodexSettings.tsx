import { LinkIcon, PlugIcon, PlugsIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { useAuthStore } from "@/features/auth";
import { Button } from "@/components/ui";
import { SettingGroup } from "./SettingGroup";
import { SettingHeader } from "./SettingHeader";
import { SettingRow } from "./SettingRow";

function formatDate(value: string | null) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString();
}

export function CodexSettings() {
    const { auth, isLoading, isConnecting, isDisconnecting, error, connect, disconnect } =
        useAuthStore();

    const isConnected = Boolean(auth?.connected);
    const isBusy = isLoading || isConnecting || isDisconnecting;

    return (
        <div className="mx-auto w-full max-w-xl p-8">
            <SettingHeader
                title="Codex"
                description="Connect to your OpenAI Codex account to enable AI responses in conversations."
            />

            <div className="flex flex-col gap-4">
                <SettingGroup>
                    <SettingRow
                        icon={<PlugIcon size={18} weight="duotone" />}
                        label="Connection status"
                        description={
                            isLoading
                                ? "Checking connection..."
                                : isConnected
                                  ? "Authenticated and ready to use Codex"
                                  : "Not connected — click Connect Codex to authenticate"
                        }
                    >
                        <span
                            className={cn(
                                "flex items-center gap-1.5 text-xs font-medium",
                                isLoading
                                    ? "text-amber-400"
                                    : isConnected
                                      ? "text-green-400"
                                      : "text-dark-400"
                            )}
                        >
                            <span
                                className={cn(
                                    "size-1.5 rounded-full",
                                    isLoading
                                        ? "animate-pulse bg-amber-400"
                                        : isConnected
                                          ? "bg-green-400"
                                          : "bg-dark-500"
                                )}
                            />
                            {isLoading
                                ? "Loading"
                                : isConnected
                                  ? "Connected"
                                  : "Disconnected"}
                        </span>
                    </SettingRow>

                    {isConnected && (
                        <>
                            <SettingRow
                                icon={<LinkIcon size={18} weight="duotone" />}
                                label="Account ID"
                            >
                                <span className="font-mono text-xs text-dark-300">
                                    {auth?.accountId ?? "—"}
                                </span>
                            </SettingRow>

                            <SettingRow label="Email">
                                <span className="text-xs text-dark-300">
                                    {auth?.email ?? "—"}
                                </span>
                            </SettingRow>

                            <SettingRow label="Token expires">
                                <span className="text-xs text-dark-300">
                                    {formatDate(auth?.expires ?? null)}
                                </span>
                            </SettingRow>

                            <SettingRow label="Connected at">
                                <span className="text-xs text-dark-300">
                                    {formatDate(auth?.connectedAt ?? null)}
                                </span>
                            </SettingRow>
                        </>
                    )}
                </SettingGroup>

                <SettingGroup>
                    <SettingRow
                        icon={<PlugsIcon size={18} weight="duotone" />}
                        label="Browser OAuth"
                        description="Opens OpenAI in your browser and stores the Codex session locally at ~/.agnt/auth.json."
                    >
                        {isConnected ? (
                            <Button
                                variant="danger"
                                size="sm"
                                disabled={isBusy}
                                onClick={() => void disconnect()}
                            >
                                {isDisconnecting ? "Disconnecting..." : "Disconnect"}
                            </Button>
                        ) : (
                            <Button
                                variant="primary"
                                size="sm"
                                disabled={isBusy}
                                loading={isConnecting}
                                onClick={() => void connect()}
                            >
                                {isConnecting ? "Connecting..." : "Connect Codex"}
                            </Button>
                        )}
                    </SettingRow>
                </SettingGroup>

                {error && (
                    <div className="rounded-md border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                        {error}
                    </div>
                )}
            </div>
        </div>
    );
}
