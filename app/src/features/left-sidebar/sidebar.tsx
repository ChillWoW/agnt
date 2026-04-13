import { cn } from "@/lib/cn";
import { useLeftSidebarStore } from "./left-sidebar-store";
import { useHotkey } from "../hotkeys";
import { ArrowLeftIcon, NavigationArrowIcon } from "@phosphor-icons/react";
import { LeftSidebarButton } from "./left-sidebar-button";
import { settingsCategories } from "@/components/settings/SettingsPanel";
import { useSettingsStore } from "@/components/settings";
import type { ElementType } from "react";

function groupCategories<T extends { group: string }>(cats: T[]) {
    const map = new Map<string, T[]>();
    for (const cat of cats) {
        const bucket = map.get(cat.group) ?? [];
        bucket.push(cat);
        map.set(cat.group, bucket);
    }
    return map;
}

export function LeftSidebar() {
    const { isCollapsed, toggleSidebar } = useLeftSidebarStore();
    const {
        isOpen: settingsOpen,
        setActiveCategory: onSettingsCategoryChange,
        close: closeSettings,
        activeCategory
    } = useSettingsStore();

    useHotkey({
        id: "layout.sidebar.toggle",
        label: "Toggle sidebar",
        defaultCombo: "Ctrl+B",
        handler: toggleSidebar
    });

    const closeSettingsPanel = () => {
        onSettingsCategoryChange("general");
        closeSettings();
    };

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
                        <div className="flex flex-col gap-4 px-2 py-3">
                            <LeftSidebarButton
                                Icon={ArrowLeftIcon}
                                label="Back"
                                onClick={closeSettingsPanel}
                                hotkey="Esc"
                            />

                            {[
                                ...groupCategories(settingsCategories).entries()
                            ].map(([group, items]) => (
                                <div
                                    key={group}
                                    className="flex flex-col gap-0.5"
                                >
                                    <p className="px-1.5 pb-1 text-xs font-semibold text-dark-300 uppercase">
                                        {group}
                                    </p>
                                    {items.map((cat) => (
                                        <LeftSidebarButton
                                            key={cat.key}
                                            Icon={cat.icon as ElementType}
                                            label={cat.label}
                                            onClick={() =>
                                                onSettingsCategoryChange?.(
                                                    cat.key
                                                )
                                            }
                                            isActive={
                                                settingsOpen &&
                                                activeCategory === cat.key
                                            }
                                        />
                                    ))}
                                </div>
                            ))}
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
