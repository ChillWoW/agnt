import { useState, type ReactNode } from "react";
import {
    XIcon,
    GearIcon,
    RocketLaunchIcon,
    TrayArrowDownIcon,
    WarningCircleIcon
} from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { Switch } from "@/components/ui";
import { useSettings } from "@/features/settings";
import type { SettingsCategory } from "@/typings/settings";

interface SettingsPanelProps {
    open: boolean;
    onClose: () => void;
}

type CategoryMeta = {
    key: SettingsCategory;
    label: string;
    icon: ReactNode;
};

const categories: CategoryMeta[] = [
    {
        key: "general",
        label: "General",
        icon: <GearIcon size={16} weight="duotone" />
    }
];

export function SettingsPanel({ open, onClose }: SettingsPanelProps) {
    const [activeCategory, setActiveCategory] =
        useState<SettingsCategory>("general");

    if (!open) return null;

    return (
        <div
            className={cn(
                "absolute inset-0 z-30 flex flex-col bg-dark-950",
                "animate-in fade-in-0 duration-150 ease-out"
            )}
        >
            {/* Header */}
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-dark-700 px-5">
                <h1 className="text-sm font-semibold tracking-wide uppercase text-dark-200">
                    Settings
                </h1>
                <button
                    type="button"
                    onClick={onClose}
                    className={cn(
                        "flex size-7 items-center justify-center rounded-md",
                        "text-dark-200 transition-colors duration-150",
                        "hover:bg-dark-800 hover:text-dark-50"
                    )}
                >
                    <XIcon size={14} weight="bold" />
                </button>
            </div>

            {/* Body */}
            <div className="flex min-h-0 flex-1">
                {/* Category sidebar */}
                <nav className="flex w-52 shrink-0 flex-col gap-0.5 border-r border-dark-700/50 bg-dark-950 p-3">
                    {categories.map((cat) => (
                        <button
                            key={cat.key}
                            type="button"
                            onClick={() => setActiveCategory(cat.key)}
                            className={cn(
                                "flex items-center gap-2.5 rounded-md px-3 py-2",
                                "text-[13px] font-medium transition-all duration-150",
                                activeCategory === cat.key
                                    ? "bg-dark-800 text-dark-50 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]"
                                    : "text-dark-300 hover:bg-dark-900 hover:text-dark-100"
                            )}
                        >
                            <span
                                className={cn(
                                    "shrink-0",
                                    activeCategory === cat.key
                                        ? "text-dark-100"
                                        : "text-dark-400"
                                )}
                            >
                                {cat.icon}
                            </span>
                            {cat.label}
                        </button>
                    ))}
                </nav>

                {/* Settings content */}
                <div className="flex-1 overflow-y-auto">
                    {activeCategory === "general" && <GeneralSettingsContent />}
                </div>
            </div>
        </div>
    );
}

// ─── General Settings ─────────────────────────────────────────────────────────

function GeneralSettingsContent() {
    const { settings, updateCategory } = useSettings();
    const general = settings.general;

    return (
        <div className="mx-auto w-full max-w-xl p-6">
            <div className="mb-6">
                <h2 className="text-base font-semibold text-dark-50">
                    General
                </h2>
                <p className="mt-1 text-[13px] text-dark-300">
                    Core application behavior and preferences.
                </p>
            </div>

            <div className="flex flex-col divide-y divide-dark-700/60 rounded-lg border border-dark-700/60 bg-dark-900/50">
                <SettingRow
                    icon={
                        <RocketLaunchIcon
                            size={18}
                            weight="duotone"
                            className="text-dark-300"
                        />
                    }
                    label="Launch at startup"
                    description="Automatically start Agnt when you log in."
                >
                    <Switch
                        checked={general.launchAtStartup}
                        onCheckedChange={(checked) =>
                            void updateCategory("general", {
                                launchAtStartup: checked
                            })
                        }
                    />
                </SettingRow>

                <SettingRow
                    icon={
                        <TrayArrowDownIcon
                            size={18}
                            weight="duotone"
                            className="text-dark-300"
                        />
                    }
                    label="Minimize to tray"
                    description="Keep running in the system tray when the window is closed."
                >
                    <Switch
                        checked={general.minimizeToTray}
                        onCheckedChange={(checked) =>
                            void updateCategory("general", {
                                minimizeToTray: checked
                            })
                        }
                    />
                </SettingRow>

                <SettingRow
                    icon={
                        <WarningCircleIcon
                            size={18}
                            weight="duotone"
                            className="text-dark-300"
                        />
                    }
                    label="Confirm on close"
                    description="Show a confirmation dialog before quitting the app."
                >
                    <Switch
                        checked={general.confirmOnClose}
                        onCheckedChange={(checked) =>
                            void updateCategory("general", {
                                confirmOnClose: checked
                            })
                        }
                    />
                </SettingRow>
            </div>
        </div>
    );
}

// ─── Setting Row ──────────────────────────────────────────────────────────────

interface SettingRowProps {
    icon?: ReactNode;
    label: string;
    description?: string;
    children: ReactNode;
}

function SettingRow({ icon, label, description, children }: SettingRowProps) {
    return (
        <div className="flex items-center justify-between gap-4 px-4 py-3.5">
            <div className="flex items-start gap-3">
                {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
                <div className="flex flex-col gap-0.5">
                    <span className="text-[13px] font-medium text-dark-50">
                        {label}
                    </span>
                    {description && (
                        <span className="text-xs text-dark-400 leading-relaxed">
                            {description}
                        </span>
                    )}
                </div>
            </div>
            <div className="shrink-0">{children}</div>
        </div>
    );
}
