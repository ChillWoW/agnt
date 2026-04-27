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
import { useAgenticMode, type AgenticMode } from "@/features/plans";
import { usePaneFocus } from "@/features/split-panes";

interface AgenticModeSelectorProps {
    workspaceId?: string | null;
    conversationId?: string | null;
}

const OPTIONS: Array<{ value: AgenticMode; label: string }> = [
    { value: "agent", label: "Agent" },
    { value: "plan", label: "Plan" }
];

function labelFor(mode: AgenticMode) {
    return OPTIONS.find((opt) => opt.value === mode)?.label ?? mode;
}

export function AgenticModeSelector({
    workspaceId,
    conversationId
}: AgenticModeSelectorProps) {
    const [open, setOpen] = useState(false);
    const { mode, setAgenticMode } = useAgenticMode({
        workspaceId,
        conversationId
    });

    const cycleHotkey = useResolvedHotkeyCombo("models.agentic-mode.cycle");

    // Only the focused split pane should react to chord — otherwise the
    // most recently mounted pane wins every keystroke since it owns the
    // newest hotkey registration.
    const isPaneFocused = usePaneFocus();
    useHotkey({
        id: "models.agentic-mode.cycle",
        label: "Cycle agentic mode",
        description: "Toggle between Agent and Plan modes",
        defaultCombo: "Shift+Tab",
        enabled: isPaneFocused,
        handler: () => {
            const next = mode === "agent" ? "plan" : "agent";
            void setAgenticMode(next);
        }
    });

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger className="w-auto">
                <Button
                    variant="ghost"
                    size="sm"
                    className={cn(
                        "h-7 gap-2 hover:bg-dark-800",
                        mode === "plan" ? "text-amber-400" : "text-dark-200"
                    )}
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
                    <span className="text-xs text-dark-200">Mode</span>
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
                                    void setAgenticMode(option.value);
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
