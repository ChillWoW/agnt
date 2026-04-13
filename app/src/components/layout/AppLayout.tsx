import { type ReactNode, useEffect, useState } from "react";
import {
    ArrowLeftIcon,
    CopyIcon,
    GearSixIcon,
    MinusIcon,
    SidebarIcon,
    SquareIcon,
    XIcon
} from "@phosphor-icons/react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { cn } from "@/lib/cn";
import { SettingsPanel } from "@/components/settings";
import { useOS } from "@/lib/useOS";
import { useHotkey, useResolvedHotkeyCombo } from "@/features/hotkeys";
import { KeybindTooltip } from "../ui";
import { LeftSidebar } from "@/features/left-sidebar";
import { useLeftSidebarStore } from "@/features/left-sidebar/left-sidebar-store";

interface AppLayoutProps {
    children: ReactNode;
}

const desktop = isTauri();

export function AppLayout({ children }: AppLayoutProps) {
    const os = useOS();
    const { isCollapsed, toggleSidebar, setCollapsed } = useLeftSidebarStore();

    const [isMaximized, setIsMaximized] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [activeSettingsCategory, setActiveSettingsCategory] = useState("general");
    const appWindow = getCurrentWindow();

    useEffect(() => {
        const checkMaximized = async () => {
            const maximized = await appWindow.isMaximized();
            setIsMaximized(maximized);
        };

        checkMaximized();

        const unlisten = appWindow.onResized(async () => {
            const maximized = await appWindow.isMaximized();
            setIsMaximized(maximized);
        });

        return () => {
            unlisten.then((fn) => fn());
        };
    }, [appWindow]);

    const handleMinimize = async () => {
        await appWindow.minimize();
    };

    const handleMaximize = async () => {
        await appWindow.toggleMaximize();
    };

    const handleClose = async () => {
        await appWindow.close();
    };

    const openSettings = () => {
        setSettingsOpen(true);
        setCollapsed(false);
    };

    const closeSettings = () => {
        setSettingsOpen(false);
    };

    useHotkey({
        id: "layout.settings",
        label: "Open Settings",
        defaultCombo: "Ctrl+,",
        handler: () => (settingsOpen ? closeSettings() : openSettings())
    });

    return (
        <div className="flex min-h-screen flex-col bg-dark-950 text-dark-50">
            <header
                data-tauri-drag-region
                className="flex h-9 shrink-0 items-center justify-between border-b border-dark-700 pl-4"
                onMouseDown={(event) => {
                    if (
                        !desktop ||
                        event.button !== 0 ||
                        (event.target as HTMLElement).closest("button")
                    ) {
                        return;
                    }

                    void appWindow.startDragging();
                }}
                onDoubleClick={() => {
                    void handleMaximize();
                }}
            >
                <div className="flex items-center gap-2">
                    {settingsOpen ? (
                        <button
                            type="button"
                            onClick={closeSettings}
                            className="flex items-center gap-1.5 text-xs font-medium text-dark-400 hover:text-dark-100 transition-colors duration-150 px-1 py-0.5 rounded"
                        >
                            <ArrowLeftIcon className="size-3.5" weight="bold" />
                            Back
                        </button>
                    ) : (
                        <button
                            onClick={toggleSidebar}
                            className={cn(
                                "size-6 p-0 hover:bg-dark-800 text-dark-200 hover:text-dark-50 rounded-md flex items-center justify-center",
                                !isCollapsed && "bg-dark-800 text-dark-50"
                            )}
                        >
                            <SidebarIcon className="size-4" />
                        </button>
                    )}
                </div>
                <div className="flex-1"></div>
                <div className="flex items-stretch self-stretch">
                    <KeybindTooltip
                        keybind={useResolvedHotkeyCombo("layout.settings")}
                        content="Open Settings"
                    >
                        <button
                            type="button"
                            onClick={() => settingsOpen ? closeSettings() : openSettings()}
                            className={cn(
                                "flex w-10 items-center justify-center text-dark-200 transition-colors duration-150",
                                "hover:bg-dark-900 hover:text-dark-50",
                                settingsOpen && "bg-dark-900 text-dark-50"
                            )}
                        >
                            <GearSixIcon
                                className="size-3.5"
                                weight={settingsOpen ? "fill" : "bold"}
                            />
                        </button>
                    </KeybindTooltip>
                    {(os === "windows" || os === "linux") && (
                        <div className="flex items-stretch self-stretch">
                            <WindowControlButton
                                onClick={() => {
                                    void handleMinimize();
                                }}
                            >
                                <MinusIcon className="size-3.5" weight="bold" />
                            </WindowControlButton>
                            <WindowControlButton
                                onClick={() => {
                                    void handleMaximize();
                                }}
                            >
                                {isMaximized ? (
                                    <CopyIcon
                                        className="size-3.5"
                                        weight="bold"
                                    />
                                ) : (
                                    <SquareIcon
                                        className="size-3.5"
                                        weight="bold"
                                    />
                                )}
                            </WindowControlButton>
                            <WindowControlButton
                                danger
                                onClick={() => {
                                    void handleClose();
                                }}
                            >
                                <XIcon className="size-3.5" weight="bold" />
                            </WindowControlButton>
                        </div>
                    )}
                </div>
            </header>

            <div className="flex flex-1 overflow-hidden">
                <LeftSidebar
                    settingsOpen={settingsOpen}
                    activeSettingsCategory={activeSettingsCategory}
                    onSettingsCategoryChange={setActiveSettingsCategory}
                />
                <main className="relative min-h-0 min-w-0 flex-1 overflow-auto">
                    {children}
                    <SettingsPanel
                        open={settingsOpen}
                        onClose={closeSettings}
                        activeCategory={activeSettingsCategory}
                    />
                </main>
            </div>
        </div>
    );
}

interface WindowControlButtonProps {
    children: ReactNode;
    danger?: boolean;
    onClick: () => void;
}

function WindowControlButton({
    children,
    danger = false,
    onClick
}: WindowControlButtonProps) {
    return (
        <button
            type="button"
            className={cn(
                "flex h-full w-10 items-center justify-center self-stretch text-dark-100 transition-colors duration-150 hover:bg-dark-900 hover:text-dark-50",
                danger &&
                    "hover:border-red-500/30 hover:bg-red-600 hover:text-white"
            )}
            onClick={onClick}
        >
            {children}
        </button>
    );
}
