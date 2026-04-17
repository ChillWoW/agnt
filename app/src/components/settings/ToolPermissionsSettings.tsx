import { useEffect, useState } from "react";
import { ShieldCheckIcon, WrenchIcon } from "@phosphor-icons/react";
import { Select } from "@/components/ui";
import { useSettings } from "@/features/settings";
import {
    fetchTools,
    type ToolCatalogEntry
} from "@/features/permissions";
import type { ToolPermissionDecision } from "@/typings/settings";
import { SettingGroup } from "./SettingGroup";
import { SettingHeader } from "./SettingHeader";
import { SettingRow } from "./SettingRow";

const DECISION_LABELS: Record<ToolPermissionDecision, string> = {
    ask: "Ask",
    allow: "Always allow",
    deny: "Always deny"
};

const DECISION_OPTIONS: ToolPermissionDecision[] = ["ask", "allow", "deny"];

function formatToolLabel(name: string): string {
    return name
        .split("_")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
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

    const handleChange = (toolName: string, decision: ToolPermissionDecision) => {
        void updateCategory("toolPermissions", {
            defaults: { ...defaults, [toolName]: decision }
        });
    };

    return (
        <div className="mx-auto w-full max-w-xl p-8">
            <SettingHeader
                title="Tool permissions"
                description="Choose whether the agent must ask before running each tool. When in Ask mode, tools set to Ask require approval per run; Always allow runs silently, Always deny blocks the tool."
            />

            <div className="flex flex-col gap-4">
                <SettingGroup>
                    <SettingRow
                        icon={<ShieldCheckIcon size={18} weight="duotone" />}
                        label="Defaults"
                        description={
                            isLoading
                                ? "Loading tools..."
                                : "Per-tool policy. The chat mode selector can override with Bypass permissions."
                        }
                    >
                        <span className="text-xs text-dark-300">
                            {tools.length > 0 ? `${tools.length} tool${tools.length === 1 ? "" : "s"}` : "—"}
                        </span>
                    </SettingRow>

                    {tools.map((tool) => {
                        const current =
                            defaults[tool.name] ?? ("ask" as ToolPermissionDecision);

                        return (
                            <SettingRow
                                key={tool.name}
                                icon={<WrenchIcon size={18} weight="duotone" />}
                                label={formatToolLabel(tool.name)}
                                description={tool.description}
                            >
                                <Select
                                    value={current}
                                    onValueChange={(value) =>
                                        handleChange(
                                            tool.name,
                                            value as ToolPermissionDecision
                                        )
                                    }
                                    wrapperClassName="w-44"
                                    triggerClassName="h-8"
                                >
                                    {DECISION_OPTIONS.map((decision) => (
                                        <Select.Item
                                            key={decision}
                                            value={decision}
                                        >
                                            {DECISION_LABELS[decision]}
                                        </Select.Item>
                                    ))}
                                </Select>
                            </SettingRow>
                        );
                    })}
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
