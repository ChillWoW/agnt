import { useCallback, useEffect, useRef, useState } from "react";
import { useHotkey } from "@/features/hotkeys";
import { useSettingsStore } from "@/components/settings";
import { useRightSidebarStore } from "./right-sidebar-store";
import { cn } from "@/lib/cn";
import {
    GitBranchIcon,
    GlobeIcon,
    TerminalIcon,
    FolderOpenIcon
} from "@phosphor-icons/react";
import { GitTab, BrowserTab, TerminalsTab, FiletreeTab } from "./tabs";
import { KeybindTooltip } from "@/components/ui/Tooltip";
import type { HotkeyCombo } from "@/features/hotkeys/types";

const MAIN_MIN_VISIBLE = 20;

type Tab = "git" | "browser" | "terminal" | "filetree";

const TABS: {
    id: Tab;
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
    const [activeTab, setActiveTab] = useState<Tab>("git");

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
        handler: () => setActiveTab("git")
    });

    useHotkey({
        id: "layout.right-sidebar.filetree",
        label: "Open Files tab",
        defaultCombo: "Ctrl+G",
        handler: () => setActiveTab("filetree")
    });

    useHotkey({
        id: "layout.right-sidebar.browser",
        label: "Open Browser tab",
        defaultCombo: "Ctrl+Alt+B",
        handler: () => setActiveTab("browser")
    });

    useHotkey({
        id: "layout.right-sidebar.terminals",
        label: "Open Terminals tab",
        defaultCombo: "Ctrl+T",
        handler: () => setActiveTab("terminal")
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
                        <div className="flex h-8 shrink-0 items-center border-b border-dark-700 px-2.5 gap-0.5">
                            {TABS.map(({ id, label, Icon, hotkey }) => (
                                <KeybindTooltip
                                    key={id}
                                    content={label}
                                    keybind={hotkey}
                                    side="bottom"
                                    sideOffset={6}
                                >
                                    <button
                                        onClick={() => setActiveTab(id)}
                                        className={cn(
                                            "flex items-center justify-center size-6 rounded transition-colors",
                                            activeTab === id
                                                ? "bg-dark-700 text-dark-50"
                                                : "text-dark-300 hover:bg-dark-800 hover:text-dark-100"
                                        )}
                                    >
                                        <Icon className="size-3.5" />
                                    </button>
                                </KeybindTooltip>
                            ))}
                        </div>

                        <div className="flex flex-1 overflow-hidden">
                            {activeTab === "git" && <GitTab />}
                            {activeTab === "browser" && <BrowserTab />}
                            {activeTab === "terminal" && <TerminalsTab />}
                            {activeTab === "filetree" && <FiletreeTab />}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
