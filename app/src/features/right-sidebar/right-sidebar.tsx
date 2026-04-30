import { useCallback, useEffect, useRef } from "react";
import { useHotkey } from "@/features/hotkeys";
import { useSettingsStore } from "@/components/settings";
import { useRightSidebarStore } from "./right-sidebar-store";
import { useWorkspaceStore } from "@/features/workspaces";
import { cn } from "@/lib/cn";
import {
    GitBranchIcon,
    GlobeIcon,
    TerminalIcon,
    FolderOpenIcon,
    XIcon
} from "@phosphor-icons/react";
import { GitTab, TerminalsTab, FiletreeTab } from "./tabs";
import {
    BrowserTabView,
    closeBrowserTab,
    openNewTab,
    reconcileAliveBrowsers,
    useBrowserStore
} from "./browser";
import { PlanPanel, PLAN_FILE_PREFIX } from "@/features/plans/PlanPanel";
import { KeybindTooltip } from "@/components/ui/Tooltip";
import type { HotkeyCombo } from "@/features/hotkeys/types";
import {
    FileViewer,
    getFileIcon,
    useOpenedFilesStore,
    type SystemTabId
} from "./filetree";

const MAIN_MIN_VISIBLE = 20;

type SystemEntry = {
    id: SystemTabId;
    label: string;
    Icon: React.ElementType;
    hotkey?: HotkeyCombo;
    onClick: "set-active" | "open-new-browser-tab";
};

const TABS: SystemEntry[] = [
    {
        id: "git",
        label: "Git",
        Icon: GitBranchIcon,
        hotkey: "Ctrl+Shift+G",
        onClick: "set-active"
    },
    {
        id: "browser",
        label: "New browser tab",
        Icon: GlobeIcon,
        hotkey: "Ctrl+Alt+B",
        onClick: "open-new-browser-tab"
    },
    {
        id: "terminal",
        label: "Terminals",
        Icon: TerminalIcon,
        hotkey: "Ctrl+T",
        onClick: "set-active"
    },
    {
        id: "filetree",
        label: "Files",
        Icon: FolderOpenIcon,
        hotkey: "Ctrl+G",
        onClick: "set-active"
    }
];

export function RightSidebar() {
    const { isCollapsed, width, setWidth, toggleSidebar } =
        useRightSidebarStore();
    const { isOpen: settingsOpen } = useSettingsStore();
    const containerRef = useRef<HTMLDivElement>(null);

    const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
    const setOpenedFilesWorkspace = useOpenedFilesStore((s) => s.setWorkspace);
    const active = useOpenedFilesStore((s) => s.active);
    const setActive = useOpenedFilesStore((s) => s.setActive);
    const order = useOpenedFilesStore((s) => s.order);
    const files = useOpenedFilesStore((s) => s.files);
    const closeFile = useOpenedFilesStore((s) => s.closeFile);

    const browserTabs = useBrowserStore((s) => s.tabs);
    const browserLoading = useBrowserStore((s) => s.loadingByTabId);

    useEffect(() => {
        setOpenedFilesWorkspace(activeWorkspaceId);
    }, [activeWorkspaceId, setOpenedFilesWorkspace]);

    useEffect(() => {
        // On first mount, reap any webview the host may have left behind
        // from a previous run that's no longer represented by a tab.
        void reconcileAliveBrowsers();
    }, []);

    const setSystemTab = useCallback(
        (id: SystemTabId) => setActive({ kind: "system", id }),
        [setActive]
    );

    const openNewBrowserTab = useCallback(() => {
        const tab = openNewTab();
        setActive({ kind: "browser", id: tab.id });
    }, [setActive]);

    const onCloseBrowserTab = useCallback(
        (id: string) => {
            const wasActive =
                active.kind === "browser" && active.id === id;
            if (wasActive) {
                // Pick the neighbor up-front so the active view never
                // briefly resolves to a now-missing tab during teardown.
                const tabs = useBrowserStore.getState().tabs;
                const idx = tabs.findIndex((t) => t.id === id);
                const remaining = tabs.filter((t) => t.id !== id);
                const neighbor =
                    remaining[Math.min(Math.max(idx, 0), remaining.length - 1)];
                if (neighbor) {
                    setActive({ kind: "browser", id: neighbor.id });
                } else {
                    setActive({ kind: "system", id: "filetree" });
                }
            }
            void closeBrowserTab(id);
        },
        [active, setActive]
    );

    useHotkey({
        id: "layout.right-sidebar.toggle",
        label: "Toggle right sidebar",
        defaultCombo: "Ctrl+Shift+B",
        handler: toggleSidebar
    });

    useHotkey({
        id: "layout.right-sidebar.git",
        label: "Open Git tab",
        defaultCombo: "Ctrl+Shift+G",
        handler: () => setSystemTab("git")
    });

    useHotkey({
        id: "layout.right-sidebar.filetree",
        label: "Open Files tab",
        defaultCombo: "Ctrl+G",
        handler: () => setSystemTab("filetree")
    });

    useHotkey({
        id: "layout.right-sidebar.browser",
        label: "Open new browser tab",
        defaultCombo: "Ctrl+Alt+B",
        handler: openNewBrowserTab
    });

    useHotkey({
        id: "layout.right-sidebar.terminals",
        label: "Open Terminals tab",
        defaultCombo: "Ctrl+T",
        handler: () => setSystemTab("terminal")
    });

    const isDragging = useRef(false);
    const startX = useRef(0);
    const startWidth = useRef(0);
    const maxWidth = useRef(0);
    const innerRef = useRef<HTMLDivElement>(null);

    const onMouseDown = useCallback(
        (e: React.MouseEvent) => {
            e.preventDefault();
            isDragging.current = true;
            startX.current = e.clientX;
            startWidth.current = width;
            const parentWidth =
                containerRef.current?.parentElement?.offsetWidth ??
                window.innerWidth;
            maxWidth.current = parentWidth - MAIN_MIN_VISIBLE;
            document.body.style.cursor = "col-resize";
            document.body.style.userSelect = "none";
        },
        [width]
    );

    useEffect(() => {
        const onMouseMove = (e: MouseEvent) => {
            if (!isDragging.current) return;
            const delta = startX.current - e.clientX;
            const next = Math.max(
                200,
                Math.min(maxWidth.current, startWidth.current + delta)
            );
            if (containerRef.current) containerRef.current.style.width = `${next}px`;
            if (innerRef.current) innerRef.current.style.width = `${next}px`;
        };

        const onMouseUp = (e: MouseEvent) => {
            if (!isDragging.current) return;
            isDragging.current = false;
            document.body.style.cursor = "";
            document.body.style.userSelect = "";
            const delta = startX.current - e.clientX;
            const next = Math.max(
                200,
                Math.min(maxWidth.current, startWidth.current + delta)
            );
            setWidth(next);
        };

        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);

        return () => {
            window.removeEventListener("mousemove", onMouseMove);
            window.removeEventListener("mouseup", onMouseUp);
        };
    }, [setWidth]);

    const hasPills = order.length > 0 || browserTabs.length > 0;
    const activeSystem = active.kind === "system" ? active.id : null;
    const activeFilePath = active.kind === "file" ? active.path : null;
    const activeBrowserId = active.kind === "browser" ? active.id : null;

    // Native webview overlays must be hidden whenever they could paint
    // over UI we'd otherwise show in their rectangle (collapsed sidebar,
    // settings panel, or simply not the active tab).
    const browserOccluded = isCollapsed || settingsOpen;

    return (
        <div
            ref={containerRef}
            className="relative shrink-0 border-l border-dark-700"
            style={{ width: isCollapsed || settingsOpen ? 0 : width }}
        >
            {!isCollapsed && !settingsOpen && (
                <>
                    <div
                        onMouseDown={onMouseDown}
                        className="absolute left-0 top-0 z-10 h-full w-1 cursor-col-resize hover:bg-dark-600 active:bg-dark-500 transition-colors duration-100"
                    />

                    <div
                        ref={innerRef}
                        className="flex h-full flex-col overflow-hidden"
                        style={{ width }}
                    >
                        <div className="flex h-8 shrink-0 items-center border-b border-dark-700 pl-2.5 pr-1 gap-0.5">
                            <div className="flex shrink-0 items-center gap-0.5">
                                {TABS.map(
                                    ({ id, label, Icon, hotkey, onClick }) => (
                                        <KeybindTooltip
                                            key={id}
                                            content={label}
                                            keybind={hotkey}
                                            side="bottom"
                                            sideOffset={6}
                                        >
                                            <button
                                                onClick={() => {
                                                    if (
                                                        onClick ===
                                                        "open-new-browser-tab"
                                                    ) {
                                                        openNewBrowserTab();
                                                    } else {
                                                        setSystemTab(id);
                                                    }
                                                }}
                                                className={cn(
                                                    "flex items-center justify-center size-6 rounded transition-colors",
                                                    activeSystem === id
                                                        ? "bg-dark-800 text-dark-50"
                                                        : "text-dark-300 hover:bg-dark-800 hover:text-dark-100"
                                                )}
                                            >
                                                <Icon className="size-3.5" />
                                            </button>
                                        </KeybindTooltip>
                                    )
                                )}
                            </div>

                            {hasPills && (
                                <>
                                    <div
                                        aria-hidden
                                        className="mx-1 h-4 w-px shrink-0 bg-dark-700"
                                    />
                                    <div className="flex min-w-0 flex-1 items-center gap-0.5">
                                        {order.map((path) => {
                                            const file = files[path];
                                            if (!file) return null;
                                            return (
                                                <FilePill
                                                    key={path}
                                                    path={path}
                                                    name={file.name}
                                                    isActive={
                                                        activeFilePath === path
                                                    }
                                                    onSelect={() =>
                                                        setActive({
                                                            kind: "file",
                                                            path
                                                        })
                                                    }
                                                    onClose={() =>
                                                        closeFile(path)
                                                    }
                                                />
                                            );
                                        })}
                                        {browserTabs.map((tab) => (
                                            <BrowserPill
                                                key={tab.id}
                                                title={
                                                    tab.title ||
                                                    tab.url ||
                                                    "New tab"
                                                }
                                                url={tab.url}
                                                favicon={tab.favicon}
                                                isLoading={
                                                    browserLoading[tab.id] ??
                                                    false
                                                }
                                                isActive={
                                                    activeBrowserId === tab.id
                                                }
                                                onSelect={() =>
                                                    setActive({
                                                        kind: "browser",
                                                        id: tab.id
                                                    })
                                                }
                                                onClose={() =>
                                                    onCloseBrowserTab(tab.id)
                                                }
                                            />
                                        ))}
                                    </div>
                                </>
                            )}
                        </div>

                        <div className="flex flex-1 overflow-hidden">
                            {active.kind === "system" ? (
                                <>
                                    {active.id === "git" && <GitTab />}
                                    {active.id === "browser" && (
                                        <BrowserSystemEmpty
                                            onOpen={openNewBrowserTab}
                                        />
                                    )}
                                    {active.id === "terminal" && (
                                        <TerminalsTab />
                                    )}
                                    {active.id === "filetree" && (
                                        <FiletreeTab />
                                    )}
                                </>
                            ) : active.kind === "browser" ? (
                                // Key by tab id so switching browser tabs
                                // remounts the component with fresh local
                                // state. Without this, the `opened` flag
                                // leaks from the previous tab and causes
                                // the lazy webview-open path to short-
                                // circuit, leaving the new tab as a
                                // blank white div until the app reloads.
                                <BrowserTabView
                                    key={active.id}
                                    id={active.id}
                                    occluded={browserOccluded}
                                />
                            ) : active.path.startsWith(PLAN_FILE_PREFIX) ? (
                                <PlanPanel />
                            ) : (
                                <FileViewer path={active.path} />
                            )}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}

interface FilePillProps {
    path: string;
    name: string;
    isActive: boolean;
    onSelect: () => void;
    onClose: () => void;
}

function FilePill({ path, name, isActive, onSelect, onClose }: FilePillProps) {
    const Icon = getFileIcon(name);

    const handleMouseDown = (e: React.MouseEvent) => {
        if (e.button === 1) {
            e.preventDefault();
            onClose();
        }
    };

    return (
        <div
            onMouseDown={handleMouseDown}
            className={cn(
                "group/pill relative flex h-6 min-w-[4rem] max-w-[16rem] shrink items-center rounded transition-colors",
                isActive
                    ? "bg-dark-800 text-dark-50"
                    : "text-dark-300 hover:bg-dark-800 hover:text-dark-100"
            )}
        >
            <button
                type="button"
                onClick={onSelect}
                title={path}
                className="flex h-full min-w-0 flex-1 items-center gap-1 pl-1.5 pr-1 text-left"
            >
                <Icon className="size-3.5 shrink-0 text-dark-200" />
                <span className="truncate text-[11px] leading-none">
                    {name}
                </span>
            </button>
            <button
                type="button"
                onClick={onClose}
                className={cn(
                    "mr-0.5 flex size-4 shrink-0 items-center justify-center rounded text-dark-200 transition-opacity hover:bg-dark-600 hover:text-dark-50",
                    "opacity-0 group-hover/pill:opacity-100 focus-visible:opacity-100",
                    isActive && "opacity-60 hover:opacity-100"
                )}
            >
                <XIcon className="size-2.5" weight="bold" />
            </button>
        </div>
    );
}

interface BrowserPillProps {
    title: string;
    url: string;
    favicon: string;
    isActive: boolean;
    isLoading: boolean;
    onSelect: () => void;
    onClose: () => void;
}

function BrowserPill({
    title,
    url,
    favicon,
    isActive,
    isLoading,
    onSelect,
    onClose
}: BrowserPillProps) {
    const handleMouseDown = (e: React.MouseEvent) => {
        if (e.button === 1) {
            e.preventDefault();
            onClose();
        }
    };

    return (
        <div
            onMouseDown={handleMouseDown}
            className={cn(
                "group/pill relative flex h-6 min-w-[4rem] max-w-[16rem] shrink items-center rounded transition-colors",
                isActive
                    ? "bg-dark-800 text-dark-50"
                    : "text-dark-300 hover:bg-dark-800 hover:text-dark-100"
            )}
        >
            <button
                type="button"
                onClick={onSelect}
                title={url || title}
                className="flex h-full min-w-0 flex-1 items-center gap-1 pl-1.5 pr-1 text-left"
            >
                <BrowserPillIcon
                    favicon={favicon}
                    isLoading={isLoading}
                />
                <span className="truncate text-[11px] leading-none">
                    {title}
                </span>
            </button>
            <button
                type="button"
                onClick={onClose}
                className={cn(
                    "mr-0.5 flex size-4 shrink-0 items-center justify-center rounded text-dark-200 transition-opacity hover:bg-dark-600 hover:text-dark-50",
                    "opacity-0 group-hover/pill:opacity-100 focus-visible:opacity-100",
                    isActive && "opacity-60 hover:opacity-100"
                )}
            >
                <XIcon className="size-2.5" weight="bold" />
            </button>
        </div>
    );
}

function BrowserPillIcon({
    favicon,
    isLoading
}: {
    favicon: string;
    isLoading: boolean;
}) {
    if (isLoading) {
        return (
            <span className="size-3.5 shrink-0 inline-flex items-center justify-center">
                <span className="size-2.5 animate-spin rounded-full border border-dark-300 border-t-transparent" />
            </span>
        );
    }
    if (favicon) {
        return (
            <img
                src={favicon}
                alt=""
                className="size-3.5 shrink-0 rounded-sm object-contain"
                onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display =
                        "none";
                }}
            />
        );
    }
    return <GlobeIcon className="size-3.5 shrink-0 text-dark-200" />;
}

function BrowserSystemEmpty({ onOpen }: { onOpen: () => void }) {
    return (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-dark-300 text-xs select-none">
            <GlobeIcon className="size-6" />
            <div>No browser tabs open</div>
            <button
                type="button"
                onClick={onOpen}
                className="rounded bg-dark-800 px-3 py-1 text-[11px] text-dark-50 hover:bg-dark-700 transition-colors"
            >
                Open new browser tab
            </button>
        </div>
    );
}
