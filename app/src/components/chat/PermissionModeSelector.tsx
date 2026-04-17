import {
    CaretUpDownIcon,
    CheckIcon,
    LightningIcon,
    ShieldCheckIcon
} from "@phosphor-icons/react";
import { useState } from "react";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
    Button
} from "@/components/ui";
import { cn } from "@/lib/cn";
import { usePermissionMode, type PermissionMode } from "@/features/permissions";

interface PermissionModeSelectorProps {
    workspaceId?: string | null;
    conversationId?: string | null;
}

const OPTIONS: Array<{
    value: PermissionMode;
    label: string;
    description: string;
}> = [
    {
        value: "ask",
        label: "Ask permissions",
        description: "Ask before running tools that need approval."
    },
    {
        value: "bypass",
        label: "Bypass permissions",
        description: "Let the agent run every tool without asking."
    }
];

function modeIcon(mode: PermissionMode) {
    if (mode === "bypass") {
        return <LightningIcon className="size-3.5 shrink-0" weight="fill" />;
    }
    return <ShieldCheckIcon className="size-3.5 shrink-0" />;
}

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

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger className="w-auto">
                <Button
                    variant="ghost"
                    size="sm"
                    className={cn(
                        "h-7 gap-2 hover:bg-dark-800",
                        mode === "bypass"
                            ? "text-amber-300 hover:text-amber-200"
                            : "text-dark-200"
                    )}
                >
                    {modeIcon(mode)}
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
                                    "flex w-full items-start justify-between gap-2 rounded-sm px-2.5 py-1.5 text-left transition-colors",
                                    isActive
                                        ? "bg-dark-800"
                                        : "hover:bg-dark-800"
                                )}
                            >
                                <div className="flex min-w-0 flex-col gap-0.5">
                                    <span
                                        className={cn(
                                            "flex items-center gap-1.5 text-xs font-medium",
                                            isActive
                                                ? "text-dark-50"
                                                : "text-dark-100"
                                        )}
                                    >
                                        {modeIcon(option.value)}
                                        {option.label}
                                    </span>
                                    <span className="text-[11px] leading-snug text-dark-300">
                                        {option.description}
                                    </span>
                                </div>
                                {isActive && (
                                    <CheckIcon
                                        className="mt-0.5 size-3 shrink-0 text-dark-100"
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
