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
import { GitTab, BrowserTab, TerminalsTab, FiletreeTab } from "./tabs";
import { KeybindTooltip } from "@/components/ui/Tooltip";
import type { HotkeyCombo } from "@/features/hotkeys/types";
import {
    FileViewer,
    getFileIcon,
    useOpenedFilesStore,
    type SystemTabId
} from "./filetree";

const MAIN_MIN_VISIBLE = 20;

const TABS: {
    id: SystemTabId;
    label: string;
    Icon: React.ElementType;
    hotkey?: HotkeyCombo;
}[] = [
    { id: "git", label: "Git", Icon: GitBranchIcon, hotkey: "Ctrl+Shift+G" },
    { id: "browser", label: "Browser", Icon: GlobeIcon, hotkey: "Ctrl+Alt+B" },
    {
        id: "terminal",
        label: "Terminals",
        Icon: TerminalIcon,
        hotkey: "Ctrl+T"
    },
    { id: "filetree", label: "Files", Icon: FolderOpenIcon, hotkey: "Ctrl+G" }
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

    useEffect(() => {
        setOpenedFilesWorkspace(activeWorkspaceId);
    }, [activeWorkspaceId, setOpenedFilesWorkspace]);

    const setSystemTab = useCallback(
        (id: SystemTabId) => setActive({ kind: "system", id }),
        [setActive]
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
        label: "Open Browser tab",
        defaultCombo: "Ctrl+Alt+B",
        handler: () => setSystemTab("browser")
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
            const next = Math.min(maxWidth.current, startWidth.current + delta);
            setWidth(next);
        };

        const onMouseUp = () => {
            if (!isDragging.current) return;
            isDragging.current = false;
            document.body.style.cursor = "";
            document.body.style.userSelect = "";
        };

        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);

        return () => {
            window.removeEventListener("mousemove", onMouseMove);
            window.removeEventListener("mouseup", onMouseUp);
        };
    }, [setWidth]);

    const hasOpenedFiles = order.length > 0;
    const activeSystem = active.kind === "system" ? active.id : null;
    const activeFilePath = active.kind === "file" ? active.path : null;

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
                        className="flex h-full flex-col overflow-hidden"
                        style={{ width }}
                    >
                        <div className="flex h-8 shrink-0 items-center border-b border-dark-700 pl-2.5 pr-1 gap-0.5">
                            <div className="flex shrink-0 items-center gap-0.5">
                                {TABS.map(({ id, label, Icon, hotkey }) => (
                                    <KeybindTooltip
                                        key={id}
                                        content={label}
                                        keybind={hotkey}
                                        side="bottom"
                                        sideOffset={6}
                                    >
                                        <button
                                            onClick={() => setSystemTab(id)}
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
                                ))}
                            </div>

                            {hasOpenedFiles && (
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
                                    </div>
                                </>
                            )}
                        </div>

                        <div className="flex flex-1 overflow-hidden">
                            {active.kind === "system" ? (
                                <>
                                    {active.id === "git" && <GitTab />}
                                    {active.id === "browser" && <BrowserTab />}
                                    {active.id === "terminal" && (
                                        <TerminalsTab />
                                    )}
                                    {active.id === "filetree" && (
                                        <FiletreeTab />
                                    )}
                                </>
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
