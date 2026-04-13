import { cn } from "@/lib/cn";
import { useLeftSidebarStore } from "./left-sidebar-store";
import { useHotkey } from "../hotkeys";
import { NavigationArrowIcon } from "@phosphor-icons/react";
import { LeftSidebarButton } from "./left-sidebar-button";

export function LeftSidebar() {
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
                    isCollapsed ? "w-0" : "w-80"
                )}
            >
                <div className="flex flex-col gap-2 px-2.5 pt-2.5 h-full">
                    <LeftSidebarButton
                        Icon={NavigationArrowIcon}
                        label="New Agent"
                        onClick={() => {}}
                        hotkey="Ctrl+N"
                    />
                </div>
            </div>
        </div>
    );
}
