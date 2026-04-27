import { CaretUpDownIcon, CheckIcon } from "@phosphor-icons/react";
import { useState } from "react";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
    Button
} from "@/components/ui";
import {
    HotkeyShortcut,
    useHotkey,
    useResolvedHotkeyCombo
} from "@/features/hotkeys";
import { cn } from "@/lib/cn";
import { usePermissionMode, type PermissionMode } from "@/features/permissions";
import { usePaneFocus } from "@/features/split-panes";

interface PermissionModeSelectorProps {
    workspaceId?: string | null;
    conversationId?: string | null;
}

const OPTIONS: Array<{ value: PermissionMode; label: string }> = [
    { value: "ask", label: "Ask permissions" },
    { value: "bypass", label: "Bypass permissions" }
];

function labelFor(mode: PermissionMode) {
    return OPTIONS.find((opt) => opt.value === mode)?.label ?? mode;
}

export function PermissionModeSelector({
    workspaceId,
    conversationId
}: PermissionModeSelectorProps) {
    const [open, setOpen] = useState(false);
    const { mode, setPermissionMode } = usePermissionMode({
        workspaceId,
        conversationId
    });

    const cycleHotkey = useResolvedHotkeyCombo("models.permission-mode.cycle");

    // Only the focused split pane should react to the chord (see
    // AgenticModeSelector for the rationale).
    const isPaneFocused = usePaneFocus();
    useHotkey({
        id: "models.permission-mode.cycle",
        label: "Cycle permission mode",
        description: "Toggle between Ask and Bypass permission modes",
        defaultCombo: "Ctrl+Shift+P",
        enabled: isPaneFocused,
        handler: () => {
            const next = mode === "ask" ? "bypass" : "ask";
            void setPermissionMode(next);
        }
    });

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger className="w-auto">
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-2 hover:bg-dark-800 text-dark-200"
                >
                    <span className="truncate">{labelFor(mode)}</span>
                    <CaretUpDownIcon className="size-3.5 shrink-0 text-dark-300" />
                </Button>
            </PopoverTrigger>

            <PopoverContent
                align="start"
                side="top"
                sideOffset={8}
                className="w-64 p-1"
            >
                <div className="mb-1 flex items-center justify-between px-2.5 py-1">
                    <span className="text-xs text-dark-200">Permissions</span>
                    <HotkeyShortcut combo={cycleHotkey} />
                </div>
                <div className="space-y-0.5">
                    {OPTIONS.map((option) => {
                        const isActive = mode === option.value;
                        return (
                            <button
                                key={option.value}
                                type="button"
                                onClick={() => {
                                    void setPermissionMode(option.value);
                                    setOpen(false);
                                }}
                                className={cn(
                                    "flex w-full items-center justify-between gap-2 rounded-sm px-2.5 py-1.5 text-xs transition-colors",
                                    isActive
                                        ? "bg-dark-800 text-dark-50"
                                        : "text-dark-200 hover:bg-dark-800 hover:text-dark-50"
                                )}
                            >
                                {option.label}
                                {isActive && (
                                    <CheckIcon
                                        className="size-3 shrink-0 text-dark-100"
                                        weight="bold"
                                    />
                                )}
                            </button>
                        );
                    })}
                </div>
            </PopoverContent>
        </Popover>
    );
}
