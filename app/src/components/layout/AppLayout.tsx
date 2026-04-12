import { type ReactNode, useEffect, useState } from "react";
import {
    CopyIcon,
    GearSixIcon,
    MinusIcon,
    SquareIcon,
    XIcon
} from "@phosphor-icons/react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { cn } from "@/lib/cn";
import { SettingsPanel } from "@/components/settings";
import { useOS } from "@/lib/useOS";

interface AppLayoutProps {
    children: ReactNode;
}

const desktop = isTauri();

export function AppLayout({ children }: AppLayoutProps) {
    const os = useOS();

    const [isMaximized, setIsMaximized] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
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
                <div className="flex-1"></div>
                <div className="flex items-stretch self-stretch">
                    <button
                        type="button"
                        onClick={() => setSettingsOpen((prev) => !prev)}
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
                    {(os === "windows" || os === "linux") && (
                        <div className="flex items-center">
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

            <main className="relative min-h-0 min-w-0 flex-1 overflow-auto">
                {children}
                <SettingsPanel
                    open={settingsOpen}
                    onClose={() => setSettingsOpen(false)}
                />
            </main>
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
                "flex w-10 items-center justify-center text-dark-100 transition-colors duration-150 hover:bg-dark-900 hover:text-dark-50",
                danger &&
                    "hover:border-red-500/30 hover:bg-red-600 hover:text-white"
            )}
            onClick={onClick}
        >
            {children}
        </button>
    );
}
