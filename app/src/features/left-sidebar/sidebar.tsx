import { cn } from "@/lib/cn";
import { useLeftSidebarStore } from "./left-sidebar-store";
import { useHotkey } from "../hotkeys";
import { NavigationArrowIcon } from "@phosphor-icons/react";
import { LeftSidebarButton } from "./left-sidebar-button";
import { settingsCategories } from "@/components/settings/SettingsPanel";
import type { ReactNode } from "react";

interface LeftSidebarProps {
    settingsOpen?: boolean;
    activeSettingsCategory?: string;
    onSettingsCategoryChange?: (key: string) => void;
}

function groupCategories<T extends { group: string }>(cats: T[]) {
    const map = new Map<string, T[]>();
    for (const cat of cats) {
        const bucket = map.get(cat.group) ?? [];
        bucket.push(cat);
        map.set(cat.group, bucket);
    }
    return map;
}

export function LeftSidebar({
    settingsOpen = false,
    activeSettingsCategory = "general",
    onSettingsCategoryChange
}: LeftSidebarProps) {
    const { isCollapsed, toggleSidebar } = useLeftSidebarStore();

    useHotkey({
        id: "layout.sidebar.toggle",
        label: "Toggle sidebar",
        defaultCombo: "Ctrl+B",
        handler: toggleSidebar
    });

    return (
        <div className="relative shrink-0 border-r border-dark-700">
            <div
                className={cn(
                    "flex flex-col shrink-0 h-full transition-[width] duration-100 overflow-hidden",
                    isCollapsed ? "w-0" : "w-64"
                )}
            >
                {settingsOpen ? (
                    <div className="flex flex-col h-full">
                        <div className="px-3 py-2.5 border-b border-dark-700">
                            <p className="text-xs font-semibold text-dark-400 uppercase tracking-wider">
                                Settings
                            </p>
                        </div>
                        <div className="flex flex-col gap-4 px-2 py-3">
                            {[...groupCategories(settingsCategories).entries()].map(
                                ([group, items]) => (
                                    <div key={group} className="flex flex-col gap-0.5">
                                        <p className="px-1.5 pb-1 text-xs font-semibold text-dark-500 uppercase tracking-wider">
                                            {group}
                                        </p>
                                        {items.map((cat) => (
                                            <button
                                                key={cat.key}
                                                type="button"
                                                onClick={() =>
                                                    onSettingsCategoryChange?.(cat.key)
                                                }
                                                className={cn(
                                                    "flex items-center gap-2.5 px-2.5 py-2 text-sm font-medium rounded-md transition-colors duration-150 w-full text-left",
                                                    activeSettingsCategory === cat.key
                                                        ? "bg-dark-800 text-dark-50"
                                                        : "text-dark-300 hover:bg-dark-800/60 hover:text-dark-100"
                                                )}
                                            >
                                                <span
                                                    className={cn(
                                                        "shrink-0",
                                                        activeSettingsCategory === cat.key
                                                            ? "text-dark-100"
                                                            : "text-dark-400"
                                                    )}
                                                >
                                                    {cat.icon as ReactNode}
                                                </span>
                                                {cat.label}
                                            </button>
                                        ))}
                                    </div>
                                )
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-col gap-2 px-2.5 pt-2.5 h-full">
                        <LeftSidebarButton
                            Icon={NavigationArrowIcon}
                            label="New Agent"
                            onClick={() => {}}
                            hotkey="Ctrl+N"
                        />
                    </div>
                )}
            </div>
        </div>
    );
}
