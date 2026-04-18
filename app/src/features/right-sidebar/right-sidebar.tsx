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

const MAIN_MIN_VISIBLE = 20;

type Tab = "git" | "browser" | "terminal" | "filetree";

const TABS: { id: Tab; label: string; Icon: React.ElementType }[] = [
    { id: "git", label: "Git", Icon: GitBranchIcon },
    { id: "filetree", label: "Files", Icon: FolderOpenIcon },
    { id: "browser", label: "Browser", Icon: GlobeIcon },
    { id: "terminal", label: "Terminals", Icon: TerminalIcon }
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
                        <div className="flex h-8 shrink-0 items-center border-b border-dark-700 px-2.5 gap-1">
                            {TABS.map(({ id, label, Icon }) => (
                                <button
                                    key={id}
                                    onClick={() => setActiveTab(id)}
                                    className={cn(
                                        "flex items-center gap-1.5 px-2 h-full text-xs font-medium transition-colors border-b-2 -mb-px",
                                        activeTab === id
                                            ? "text-dark-50 border-dark-50"
                                            : "text-dark-300 border-transparent hover:text-dark-100"
                                    )}
                                >
                                    <Icon className="size-3.5" />
                                    {label}
                                </button>
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
