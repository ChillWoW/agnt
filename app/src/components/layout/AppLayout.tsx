import { type ReactNode, useMemo, useState } from "react";
import { CopyIcon, GearSixIcon, MinusIcon, SquareIcon, XIcon } from "@phosphor-icons/react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { cn } from "@/lib/cn";
import { SettingsPanel } from "./SettingsPanel";

interface AppLayoutProps {
    children: ReactNode;
}

const desktop = isTauri();

export function AppLayout({ children }: AppLayoutProps) {
    const [isMaximized, setIsMaximized] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const appWindow = useMemo(() => (desktop ? getCurrentWindow() : null), []);

    const startDragging = async () => {
        if (!appWindow) {
            return;
        }

        await appWindow.startDragging();
    };

    const toggleMaximize = async () => {
        if (!appWindow) {
            return;
        }

        await appWindow.toggleMaximize();
        setIsMaximized(await appWindow.isMaximized());
    };

    const minimize = async () => {
        if (!appWindow) {
            return;
        }

        await appWindow.minimize();
    };

    const close = async () => {
        if (!appWindow) {
            return;
        }

        await appWindow.close();
    };

    return (
        <div className="flex min-h-screen flex-col bg-dark-950 text-primary-100">
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

                    void startDragging();
                }}
                onDoubleClick={() => {
                    void toggleMaximize();
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
                        <GearSixIcon size={15} weight={settingsOpen ? "fill" : "bold"} />
                    </button>
                    <WindowControlButton
                        onClick={() => {
                            void minimize();
                        }}
                    >
                        <MinusIcon size={14} weight="bold" />
                    </WindowControlButton>
                    <WindowControlButton
                        onClick={() => {
                            void toggleMaximize();
                        }}
                    >
                        {isMaximized ? (
                            <CopyIcon size={13} weight="bold" />
                        ) : (
                            <SquareIcon size={13} weight="bold" />
                        )}
                    </WindowControlButton>
                    <WindowControlButton
                        danger
                        onClick={() => {
                            void close();
                        }}
                    >
                        <XIcon size={14} weight="bold" />
                    </WindowControlButton>
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
                "flex w-10 items-center justify-center border-l border-dark-700 text-dark-100 transition-colors duration-150 hover:bg-dark-900 hover:text-dark-50",
                danger &&
                    "hover:border-red-500/30 hover:bg-red-600 hover:text-white"
            )}
            onClick={onClick}
        >
            {children}
        </button>
    );
}
