import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { useLeftSidebarStore } from "./left-sidebar-store";
import { useHotkey } from "../hotkeys";
import {
    ArrowLeftIcon,
    NavigationArrowIcon,
    FolderOpenIcon,
    CaretRightIcon,
    TrashIcon,
    PlusIcon,
    DotsThreeIcon,
    XIcon,
    MinusIcon,
    GearSixIcon
} from "@phosphor-icons/react";
import { Menu, Tooltip } from "@/components/ui";
import { open } from "@tauri-apps/plugin-dialog";
import { LeftSidebarButton } from "./left-sidebar-button";
import { settingsCategories } from "@/components/settings/SettingsPanel";
import { useSettingsStore } from "@/components/settings";
import { useWorkspaceStore } from "@/features/workspaces";
import { useConversationStore } from "@/features/conversations";
import type { ElementType } from "react";
import { useNavigate } from "@tanstack/react-router";
import { AccountButton } from "./account-button";

function groupCategories<T extends { group: string }>(cats: T[]) {
    const map = new Map<string, T[]>();
    for (const cat of cats) {
        const bucket = map.get(cat.group) ?? [];
        bucket.push(cat);
        map.set(cat.group, bucket);
    }
    return map;
}

const EMPTY_CONVERSATIONS: import("@/features/conversations").Conversation[] =
    [];

function WorkspaceConversations({ workspaceId }: { workspaceId: string }) {
    const navigate = useNavigate();
    const conversations = useConversationStore(
        (s) => s.conversationsByWorkspace[workspaceId] ?? EMPTY_CONVERSATIONS
    );
    const activeConversationId = useConversationStore(
        (s) => s.activeConversationId
    );
    const unreadConversationIds = useConversationStore(
        (s) => s.unreadConversationIds
    );
    const streamingConversationIds = useConversationStore(
        (s) => s.streamControllersById
    );

    useEffect(() => {
        void useConversationStore.getState().loadConversations(workspaceId);
    }, [workspaceId]);

    return (
        <div className="flex flex-col gap-0.5">
            {conversations.map((conv) => {
                const isUnread = Boolean(unreadConversationIds[conv.id]);
                const isStreaming = Boolean(
                    streamingConversationIds[conv.id]
                );
                const isActive = activeConversationId === conv.id;

                return (
                <div
                    key={conv.id}
                    role="button"
                    tabIndex={0}
                    onClick={() =>
                        void navigate({
                            to: "/conversations/$conversationId",
                            params: { conversationId: conv.id }
                        })
                    }
                    onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                            void navigate({
                                to: "/conversations/$conversationId",
                                params: { conversationId: conv.id }
                            });
                        }
                    }}
                    className={cn(
                        "group flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] transition-colors min-w-0 w-full text-left cursor-pointer",
                        isActive
                            ? "bg-dark-800 text-dark-50"
                            : isUnread
                              ? "text-dark-50 hover:bg-dark-800"
                              : "text-dark-300 hover:bg-dark-800 hover:text-dark-100"
                    )}
                >
                    <MinusIcon
                        className={cn(
                            "size-3 shrink-0 transition-colors",
                            isUnread
                                ? "text-dark-50"
                                : isStreaming
                                  ? "text-dark-100 animate-pulse"
                                  : "text-dark-300"
                        )}
                    />
                    <span className="truncate flex-1">{conv.title}</span>
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            void useConversationStore
                                .getState()
                                .deleteConversation(workspaceId, conv.id);
                        }}
                        className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-dark-400 hover:text-red-400 p-0.5"
                    >
                        {/* TODO: Change to archiving system */}
                        <TrashIcon className="size-3" />
                    </button>
                </div>
                );
            })}
        </div>
    );
}

function WorkspaceSidebarList() {
    const { workspaces, activeWorkspaceId, setActive, remove } =
        useWorkspaceStore();
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
    const navigate = useNavigate();

    useEffect(() => {
        if (activeWorkspaceId) {
            setExpandedIds((prev) => {
                const next = new Set(prev);
                next.add(activeWorkspaceId);
                return next;
            });
        }
    }, [activeWorkspaceId]);

    if (workspaces.length === 0) {
        return null;
    }

    const toggleExpanded = (id: string) => {
        setExpandedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    };

    return (
        <div className="flex flex-col gap-1">
            {workspaces.map((ws) => {
                const isActive = ws.id === activeWorkspaceId;
                const isExpanded = expandedIds.has(ws.id);

                return (
                    <div key={ws.id} className="flex flex-col">
                        <div className="group flex items-center gap-1 px-1 py-1 rounded-md text-[11px] transition-colors min-w-0 w-full">
                            <button
                                onClick={() => toggleExpanded(ws.id)}
                                className={cn(
                                    "flex items-center gap-1 min-w-0 flex-1 text-left",
                                    isActive
                                        ? "text-dark-50"
                                        : "text-dark-200 hover:text-dark-50"
                                )}
                            >
                                <CaretRightIcon
                                    className={cn(
                                        "size-2.5 shrink-0 transition-transform duration-100",
                                        isExpanded && "rotate-90"
                                    )}
                                    weight="bold"
                                />
                                <span className="truncate font-medium">
                                    {ws.name}
                                </span>
                            </button>

                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                <Tooltip content="New Agent" side="top">
                                    <button
                                        onClick={() => {
                                            void setActive(ws.id);
                                            void navigate({ to: "/" });
                                        }}
                                        className="text-dark-200 hover:text-dark-100"
                                    >
                                        <PlusIcon className="size-3.5" />
                                    </button>
                                </Tooltip>

                                <Menu>
                                    <Menu.Trigger className="text-dark-200 hover:text-dark-100">
                                        <DotsThreeIcon
                                            className="size-3.5"
                                            weight="bold"
                                        />
                                    </Menu.Trigger>
                                    <Menu.Content side="bottom" align="start">
                                        <Menu.Item
                                            destructive
                                            icon={
                                                <XIcon className="size-3.5" />
                                            }
                                            onClick={() => void remove(ws.id)}
                                        >
                                            Close workspace
                                        </Menu.Item>
                                    </Menu.Content>
                                </Menu>
                            </div>
                        </div>

                        {isExpanded && (
                            <div className="ml-3 mt-0.5 border-l border-dark-700 pl-1.5">
                                <WorkspaceConversations workspaceId={ws.id} />
                            </div>
                        )}
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

function NewAgentButton() {
    const navigate = useNavigate();

    const handleNewAgent = () => {
        void navigate({ to: "/" });
    };

    useHotkey({
        id: "agent.new",
        label: "New Agent",
        defaultCombo: "Ctrl+N",
        handler: handleNewAgent
    });

    return (
        <LeftSidebarButton
            Icon={NavigationArrowIcon}
            label="New Agent"
            onClick={handleNewAgent}
            hotkey="Ctrl+N"
        />
    );
}

export function LeftSidebar() {
    const { isCollapsed, toggleSidebar } = useLeftSidebarStore();
    const {
        isOpen: settingsOpen,
        setActiveCategory: onSettingsCategoryChange,
        open: openSettings,
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

    const toggleSettingsPanel = () => {
        if (settingsOpen) {
            closeSettingsPanel();
            return;
        }

        openSettings();
    };

    return (
        <div className="relative shrink-0 border-r border-dark-700">
            <div
                className={cn(
                    "flex flex-col shrink-0 h-full transition-[width] duration-100 overflow-hidden",
                    isCollapsed ? "w-0" : "w-64"
                )}
            >
                <div className="flex h-full flex-col">
                    <div className="flex-1 min-h-0">
                        {settingsOpen ? (
                            <div className="flex h-full flex-col">
                                <div className="flex flex-col gap-4 px-2 py-3">
                                    <LeftSidebarButton
                                        Icon={ArrowLeftIcon}
                                        label="Back"
                                        onClick={closeSettingsPanel}
                                        hotkey="Esc"
                                    />

                                    {[
                                        ...groupCategories(
                                            settingsCategories
                                        ).entries()
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
                                                    Icon={
                                                        cat.icon as ElementType
                                                    }
                                                    label={cat.label}
                                                    onClick={() =>
                                                        onSettingsCategoryChange?.(
                                                            cat.key
                                                        )
                                                    }
                                                    isActive={
                                                        settingsOpen &&
                                                        activeCategory ===
                                                            cat.key
                                                    }
                                                />
                                            ))}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : (
                            <div className="flex h-full flex-col px-2.5 pt-2.5">
                                <NewAgentButton />

                                <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
                                    <WorkspaceSidebarList />
                                </div>

                                <div className="shrink-0 pb-2.5 pt-1">
                                    <OpenWorkspaceButton />
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="flex shrink-0 items-center gap-1 border-t border-dark-700 px-2.5 py-2">
                        <div className="min-w-0 flex-1">
                            <AccountButton />
                        </div>

                        <Tooltip content="Settings" side="top">
                            <button
                                type="button"
                                onClick={toggleSettingsPanel}
                                className={cn(
                                    "flex size-9 shrink-0 items-center justify-center rounded-md text-dark-200 transition-colors hover:bg-dark-850 hover:text-dark-50",
                                    settingsOpen && "bg-dark-850 text-dark-50"
                                )}
                            >
                                <GearSixIcon className="size-4" weight="bold" />
                            </button>
                        </Tooltip>
                    </div>
                </div>
            </div>
        </div>
    );
}
