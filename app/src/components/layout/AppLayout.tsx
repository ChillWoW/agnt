import { type ReactNode, useEffect, useState } from "react";
import {
    CopyIcon,
    GearSixIcon,
    MinusIcon,
    SidebarIcon,
    SidebarSimpleIcon,
    SquareIcon,
    XIcon
} from "@phosphor-icons/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { cn } from "@/lib/cn";
import { SettingsPanel, useSettingsStore } from "@/components/settings";
import { useOS } from "@/lib/useOS";
import { useHotkey, useResolvedHotkeyCombo } from "@/features/hotkeys";
import { KeybindTooltip } from "../ui";
import { LeftSidebar, useLeftSidebarStore } from "@/features/left-sidebar";
import { RightSidebar, useRightSidebarStore } from "@/features/right-sidebar";

interface AppLayoutProps {
    children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
    const os = useOS();
    const { isCollapsed, toggleSidebar, setCollapsed } = useLeftSidebarStore();
    const { isCollapsed: rightCollapsed, toggleSidebar: toggleRightSidebar } =
        useRightSidebarStore();
    const {
        isOpen: settingsOpen,
        open: openSettings,
        close: closeSettings
    } = useSettingsStore();

    const [isMaximized, setIsMaximized] = useState(false);
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

    const handleOpenSettings = () => {
        openSettings();
        setCollapsed(false);
    };

    useHotkey({
        id: "layout.settings",
        label: "Open Settings",
        defaultCombo: "Ctrl+,",
        handler: () => (settingsOpen ? closeSettings() : handleOpenSettings())
    });

    return (
        <div className="flex min-h-screen flex-col bg-dark-950 text-dark-50">
            <header
                data-tauri-drag-region
                className="flex h-9 shrink-0 items-center justify-between border-b border-dark-700 pl-4"
                onDoubleClick={() => {
                    void handleMaximize();
                }}
            >
                <div className="flex items-center gap-2">
                    <KeybindTooltip
                        keybind={useResolvedHotkeyCombo(
                            "layout.sidebar.toggle"
                        )}
                        content="Toggle Sidebar"
                    >
                        <button
                            onClick={toggleSidebar}
                            className={cn(
                                "size-6 p-0 hover:bg-dark-800 text-dark-200 hover:text-dark-50 rounded-md flex items-center justify-center",
                                !isCollapsed && "bg-dark-800 text-dark-50"
                            )}
                        >
                            <SidebarIcon className="size-4" />
                        </button>
                    </KeybindTooltip>
                </div>
                <div className="flex-1"></div>
                <div className="flex items-center gap-2">
                    <KeybindTooltip
                        keybind={useResolvedHotkeyCombo(
                            "layout.right-sidebar.toggle"
                        )}
                        content="Toggle Right Sidebar"
                    >
                        <button
                            onClick={toggleRightSidebar}
                            className={cn(
                                "size-6 p-0 hover:bg-dark-800 text-dark-200 hover:text-dark-50 rounded-md flex items-center justify-center",
                                !rightCollapsed && "bg-dark-800 text-dark-50"
                            )}
                        >
                            <SidebarSimpleIcon
                                className="size-4"
                                style={{ transform: "scaleX(-1)" }}
                            />
                        </button>
                    </KeybindTooltip>
                    <KeybindTooltip
                        keybind={useResolvedHotkeyCombo("layout.settings")}
                        content="Open Settings"
                    >
                        <button
                            type="button"
                            onClick={() =>
                                settingsOpen ? closeSettings() : openSettings()
                            }
                            className={cn(
                                "size-6 p-0 hover:bg-dark-800 text-dark-200 hover:text-dark-50 rounded-md flex items-center justify-center",
                                settingsOpen && "bg-dark-800 text-dark-50"
                            )}
                        >
                            <GearSixIcon className="size-3.5" weight="bold" />
                        </button>
                    </KeybindTooltip>
                </div>
                <div className="flex items-stretch self-stretch">
                    {(os === "windows" || os === "linux") && (
                        <div className="flex items-stretch self-stretch pl-2">
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
                <LeftSidebar />
                <main className="relative min-h-0 min-w-0 flex-1 overflow-auto">
                    {children}
                    <SettingsPanel />
                </main>
                <RightSidebar />
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
