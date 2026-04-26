import {
    BugIcon,
    LightningIcon,
    FunnelIcon,
    TimerIcon
} from "@phosphor-icons/react";
import { useSettingsCategory } from "@/features/settings";
import type { DiagnosticsSeverity } from "@/typings/settings";
import { SettingHeader } from "./SettingHeader";
import { SettingGroup } from "./SettingGroup";
import { SettingRow } from "./SettingRow";
import { Switch, Select, Input } from "@/components/ui";

const SEVERITY_OPTIONS: { value: DiagnosticsSeverity; label: string }[] = [
    { value: "error", label: "Errors only" },
    { value: "warning", label: "Errors + warnings" },
    { value: "info", label: "Errors + warnings + infos" },
    { value: "hint", label: "Everything (incl. hints)" }
];

function clampWaitMs(raw: string): number {
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) return 1500;
    return Math.min(10000, Math.max(200, parsed));
}

export function DiagnosticsSettings() {
    const { settings, update } = useSettingsCategory("diagnostics");

    const masterOff = !settings.enabled;

    return (
        <div className="mx-auto w-full max-w-2xl px-10 pt-14 pb-16">
            <SettingHeader
                title="Diagnostics"
                description="Run TypeScript language-server checks against files the assistant edits. Results appear under each edit and are fed back so the assistant can self-correct."
            />

            <SettingGroup>
                <SettingRow
                    icon={<BugIcon size={16} weight="duotone" />}
                    label="Enable diagnostics"
                    description="Spawns typescript-language-server on demand per workspace."
                >
                    <Switch
                        checked={settings.enabled}
                        onCheckedChange={(enabled) =>
                            void update({ enabled })
                        }
                    />
                </SettingRow>
                <SettingRow
                    icon={<LightningIcon size={16} weight="duotone" />}
                    label="Auto-run after edits"
                    description="Check changed files after write, str_replace, and apply_patch."
                >
                    <Switch
                        disabled={masterOff}
                        checked={settings.autoRunOnEdits}
                        onCheckedChange={(autoRunOnEdits) =>
                            void update({ autoRunOnEdits })
                        }
                    />
                </SettingRow>
                <SettingRow
                    icon={<FunnelIcon size={16} weight="duotone" />}
                    label="Minimum severity"
                    description="Diagnostics below this level are hidden from the assistant and the UI."
                >
                    <div className="w-56">
                        <Select
                            disabled={masterOff}
                            value={settings.minSeverity}
                            onValueChange={(value) =>
                                void update({
                                    minSeverity: value as DiagnosticsSeverity
                                })
                            }
                        >
                            {SEVERITY_OPTIONS.map((opt) => (
                                <Select.Item
                                    key={opt.value}
                                    value={opt.value}
                                >
                                    {opt.label}
                                </Select.Item>
                            ))}
                        </Select>
                    </div>
                </SettingRow>
                <SettingRow
                    icon={<TimerIcon size={16} weight="duotone" />}
                    label="Wait timeout"
                    description="How long to wait for the language server to publish results before returning. 200–10000 ms."
                >
                    <div className="w-32">
                        <Input
                            type="number"
                            min={200}
                            max={10000}
                            step={100}
                            disabled={masterOff}
                            value={String(settings.waitMs)}
                            suffix={
                                <span className="text-[11px] text-dark-300">
                                    ms
                                </span>
                            }
                            onChange={(event) => {
                                const nextValue = clampWaitMs(
                                    (event.target as HTMLInputElement).value
                                );
                                void update({ waitMs: nextValue });
                            }}
                        />
                    </div>
                </SettingRow>
            </SettingGroup>
        </div>
    );
}
