import { cn } from "@/lib/cn";
import { useLeftSidebarStore } from "./left-sidebar-store";
import { useHotkey } from "../hotkeys";
import {
    ArrowLeftIcon,
    NavigationArrowIcon,
    FolderOpenIcon
} from "@phosphor-icons/react";
import { open } from "@tauri-apps/plugin-dialog";
import { LeftSidebarButton } from "./left-sidebar-button";
import { settingsCategories } from "@/components/settings/SettingsPanel";
import { useSettingsStore } from "@/components/settings";
import { useWorkspaceStore } from "@/features/workspaces";
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

function WorkspaceSidebarList() {
    const { workspaces, setActive } = useWorkspaceStore();

    if (workspaces.length === 0) {
        return null;
    }

    return (
        <div className="flex flex-col gap-3">
            {workspaces.map((ws) => {
                return (
                    <div key={ws.id} className="flex flex-col gap-0.5">
                        <button
                            onClick={() => setActive(ws.id)}
                            className="group flex items-center justify-between gap-1 px-1.5 py-0.5 rounded-md text-[11px] text-dark-200 transition-colors min-w-0"
                        >
                            <span className="truncate font-medium">
                                {ws.name}
                            </span>
                        </button>
                    </div>
                );
            })}
        </div>
    );
}

function OpenWorkspaceButton() {
    const add = useWorkspaceStore((s) => s.add);

    const handleOpenWorkspace = async () => {
        const folder = await open({ directory: true, multiple: false });
        if (folder) {
            await add(folder);
        }
    };

    useHotkey({
        id: "workspace.open",
        label: "Open Workspace",
        defaultCombo: "Ctrl+P",
        handler: handleOpenWorkspace
    });

    return (
        <LeftSidebarButton
            Icon={FolderOpenIcon}
            label="Open Workspace"
            onClick={handleOpenWorkspace}
            hotkey="Ctrl+P"
        />
    );
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
                    <div className="flex flex-col h-full px-2.5 pt-2.5">
                        <LeftSidebarButton
                            Icon={NavigationArrowIcon}
                            label="New Agent"
                            onClick={() => {}}
                            hotkey="Ctrl+N"
                        />

                        <div className="flex-1 overflow-y-auto mt-3 min-h-0">
                            <WorkspaceSidebarList />
                        </div>

                        <div className="shrink-0 pb-2.5 pt-1">
                            <OpenWorkspaceButton />
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
