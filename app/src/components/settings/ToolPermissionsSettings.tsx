import { useEffect, useState } from "react";
import { WarningCircleIcon } from "@phosphor-icons/react";
import { useSettings } from "@/features/settings";
import { fetchTools, type ToolCatalogEntry } from "@/features/permissions";
import type { ToolPermissionDecision } from "@/typings/settings";
import { SettingHeader } from "./SettingHeader";
import { cn } from "@/lib/cn";

const DECISIONS: ToolPermissionDecision[] = ["ask", "allow", "deny"];

const DECISION_CONFIG: Record<
    ToolPermissionDecision,
    { label: string; activeClass: string; borderClass: string }
> = {
    ask: {
        label: "Ask",
        activeClass: "bg-amber-500/15 text-amber-300 border-amber-500/40",
        borderClass: "border-l-amber-500/50"
    },
    allow: {
        label: "Allow",
        activeClass: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
        borderClass: "border-l-emerald-500/50"
    },
    deny: {
        label: "Deny",
        activeClass: "bg-red-500/15 text-red-300 border-red-500/40",
        borderClass: "border-l-red-500/50"
    }
};

function formatToolLabel(name: string): string {
    return name
        .split("_")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}

function PermissionPills({
    current,
    onChange
}: {
    current: ToolPermissionDecision;
    onChange: (d: ToolPermissionDecision) => void;
}) {
    return (
        <div className="flex items-center gap-0.5 rounded-md border border-dark-600 bg-dark-900 p-0.5">
            {DECISIONS.map((decision) => {
                const config = DECISION_CONFIG[decision];
                const isActive = current === decision;
                return (
                    <button
                        key={decision}
                        type="button"
                        onClick={() => onChange(decision)}
                        className={cn(
                            "rounded px-2.5 py-1 text-[11px] font-medium leading-none transition-all duration-150 border",
                            isActive
                                ? config.activeClass
                                : "border-transparent text-dark-400 hover:text-dark-200 hover:bg-dark-700"
                        )}
                    >
                        {config.label}
                    </button>
                );
            })}
        </div>
    );
}

export function ToolPermissionsSettings() {
    const { settings, updateCategory } = useSettings();
    const defaults = settings.toolPermissions.defaults;

    const [tools, setTools] = useState<ToolCatalogEntry[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        async function load() {
            setIsLoading(true);
            setError(null);
            try {
                const next = await fetchTools();
                if (!cancelled) setTools(next);
            } catch (err) {
                if (!cancelled) {
                    setError(
                        err instanceof Error
                            ? err.message
                            : "Failed to load tools"
                    );
                }
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        }

        void load();
        return () => {
            cancelled = true;
        };
    }, []);

    const handleChange = (
        toolName: string,
        decision: ToolPermissionDecision
    ) => {
        void updateCategory("toolPermissions", {
            defaults: { ...defaults, [toolName]: decision }
        });
    };

    return (
        <div className="mx-auto w-full max-w-xl p-8">
            <SettingHeader
                title="Tool permissions"
                description="Set whether each tool requires approval before running. Bypass permissions mode ignores these settings."
            />

            <div className="flex flex-col gap-3">
                <div className="flex flex-col divide-y divide-dark-700 rounded-md border border-dark-700 bg-dark-900 overflow-hidden">
                    {isLoading &&
                        Array.from({ length: 5 }).map((_, i) => (
                            <div
                                key={i}
                                className="flex items-center justify-between gap-4 px-4 py-3"
                            >
                                <div className="flex flex-col gap-1.5">
                                    <div className="h-3 w-24 rounded bg-dark-700 animate-pulse" />
                                    <div className="h-2.5 w-40 rounded bg-dark-800 animate-pulse" />
                                </div>
                                <div className="h-7 w-[116px] rounded-md bg-dark-800 animate-pulse" />
                            </div>
                        ))}

                    {!isLoading &&
                        tools.map((tool) => {
                            const current: ToolPermissionDecision =
                                defaults[tool.name] ?? "ask";

                            return (
                                <div
                                    key={tool.name}
                                    className="flex items-center justify-between gap-4 p-3"
                                >
                                    <div className="flex flex-col gap-0.5 min-w-0">
                                        <span className="text-xs font-medium text-dark-50 leading-tight">
                                            {formatToolLabel(tool.name)}
                                        </span>
                                        {tool.description && (
                                            <span className="text-[11px] text-dark-200 leading-tight truncate">
                                                {tool.description.length > 48
                                                    ? tool.description
                                                          .slice(0, 48)
                                                          .trimEnd() + "…"
                                                    : tool.description}
                                            </span>
                                        )}
                                    </div>
                                    <div className="shrink-0">
                                        <PermissionPills
                                            current={current}
                                            onChange={(d) =>
                                                handleChange(tool.name, d)
                                            }
                                        />
                                    </div>
                                </div>
                            );
                        })}

                    {!isLoading && tools.length === 0 && !error && (
                        <div className="flex flex-col items-center gap-2 py-10">
                            <span className="text-xs text-dark-300">
                                No tools found
                            </span>
                        </div>
                    )}
                </div>

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
