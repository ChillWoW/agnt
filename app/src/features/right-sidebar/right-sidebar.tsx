import { useCallback, useEffect, useRef } from "react";
import { useHotkey } from "@/features/hotkeys";
import { useSettingsStore } from "@/components/settings";
import { useRightSidebarStore } from "./right-sidebar-store";

const MAIN_MIN_VISIBLE = 20;

export function RightSidebar() {
    const { isCollapsed, width, setWidth, toggleSidebar } =
        useRightSidebarStore();
    const { isOpen: settingsOpen } = useSettingsStore();
    const containerRef = useRef<HTMLDivElement>(null);

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
                        <div className="flex flex-1 items-center justify-center text-dark-200 text-sm select-none">
                            Right Panel
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
