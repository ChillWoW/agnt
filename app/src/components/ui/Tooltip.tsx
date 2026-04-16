import { Tooltip as Base } from "@base-ui/react/tooltip";
import { type ReactNode, isValidElement } from "react";
import { cn } from "@/lib/cn";
import { formatHotkey } from "@/features/hotkeys/hotkeys-utils";
import type { HotkeyCombo } from "@/features/hotkeys/types";
import { useOS } from "@/lib/useOS";

interface TooltipProps {
    children: ReactNode;
    content: ReactNode;
    side?: "top" | "right" | "bottom" | "left";
    sideOffset?: number;
    align?: "start" | "center" | "end";
    delay?: number;
    disabled?: boolean;
    className?: string;
}

interface KeybindTooltipProps extends TooltipProps {
    keybind: HotkeyCombo | null | undefined;
}

export function Tooltip({
    children,
    content,
    side = "top",
    sideOffset = 6,
    align = "center",
    delay = 0,
    disabled = false,
    className
}: TooltipProps) {
    if (disabled) return children;

    return (
        <Base.Provider delay={delay}>
            <Base.Root>
                <Base.Trigger
                    render={isValidElement(children) ? children : undefined}
                >
                    {!isValidElement(children) && children}
                </Base.Trigger>

                <Base.Portal>
                    <Base.Positioner
                        sideOffset={sideOffset}
                        side={side}
                        align={align}
                        className="z-50"
                    >
                        <Base.Popup
                            className={cn(
                                "rounded-md border border-dark-600 bg-dark-850 px-2.5 py-1 text-xs text-dark-50 shadow-sm",
                                "animate-in fade-in-0 zoom-in-95 duration-150",
                                "data-[ending-style]:animate-out data-[ending-style]:fade-out-0 data-[ending-style]:zoom-out-95",
                                className
                            )}
                        >
                            {content}
                        </Base.Popup>
                    </Base.Positioner>
                </Base.Portal>
            </Base.Root>
        </Base.Provider>
    );
}

export function KeybindTooltip({
    children,
    content,
    keybind,
    side = "top",
    sideOffset = 6,
    align = "center",
    delay = 0,
    disabled = false,
    className
}: KeybindTooltipProps) {
    const os = useOS();
    const formatted = formatHotkey(keybind, os);

    if (disabled) return children;

    return (
        <Tooltip
            content={
                formatted ? (
                    <span className="inline-flex items-center gap-1.5">
                        <span>{content}</span>
                        <span className="text-dark-300">{formatted}</span>
                    </span>
                ) : (
                    content
                )
            }
            side={side}
            sideOffset={sideOffset}
            align={align}
            delay={delay}
            className={cn("max-w-sm", className)}
        >
            {children}
        </Tooltip>
    );
}
