import {
    CaretRightIcon,
    CaretUpDownIcon,
    CheckIcon,
    OpenAiLogoIcon,
    SpinnerGapIcon
} from "@phosphor-icons/react";
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
import { useModelSelection } from "@/features/models";
import type { ReasoningEffort, ModelSpeed } from "@/features/models";

interface ModelSelectorProps {
    workspaceId?: string | null;
    conversationId?: string | null;
}

function formatEffortLabel(effort: ReasoningEffort | null) {
    if (!effort) {
        return "Unavailable";
    }

    switch (effort) {
        case "xhigh":
            return "Very high";
        case "minimal":
            return "Minimal";
        default:
            return effort.charAt(0).toUpperCase() + effort.slice(1);
    }
}

function formatSpeedLabel(speed: ModelSpeed) {
    return speed === "fast" ? "Fast" : "Standard";
}

export function ModelSelector({
    workspaceId,
    conversationId
}: ModelSelectorProps) {
    const [open, setOpen] = useState(false);
    const [speedOpen, setSpeedOpen] = useState(false);
    const [reasoningOpen, setReasoningOpen] = useState(false);
    const [subagentModelOpen, setSubagentModelOpen] = useState(false);
    const [subagentReasoningOpen, setSubagentReasoningOpen] = useState(false);
    const {
        isLoading,
        models,
        selection,
        selectedModel,
        selectedReasoningEfforts,
        cycleReasoningEffort,
        selectModel,
        selectSpeed,
        selectReasoningEffort,
        subagentSelection,
        selectedSubagentModel,
        selectedSubagentReasoningEfforts,
        selectSubagentModel,
        selectSubagentReasoningEffort
    } = useModelSelection({ workspaceId, conversationId });

    const currentSubagentEffort =
        subagentSelection.reasoningEffort ??
        selectedSubagentModel?.defaultEffort ??
        selectedSubagentReasoningEfforts[0] ??
        null;

    const currentEffort =
        selection.reasoningEffort ??
        selectedModel?.defaultEffort ??
        selectedReasoningEfforts[0] ??
        null;

    const speedOptions: ModelSpeed[] = ["standard", "fast"];
    const supportsFastMode = selectedModel?.supportsFastMode ?? false;
    const reasoningCycleHotkey = useResolvedHotkeyCombo(
        "models.reasoning.cycle"
    );

    useHotkey({
        id: "models.reasoning.cycle",
        label: "Cycle reasoning",
        description: "Cycle through reasoning levels for the selected model",
        defaultCombo: "Ctrl+E",
        enabled: selectedReasoningEfforts.length > 1,
        handler: cycleReasoningEffort
    });

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger className="w-auto">
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 max-w-[18rem] gap-2 hover:bg-dark-800 text-dark-200"
                >
                    <OpenAiLogoIcon className="size-3.5 shrink-0" />
                    <span className="truncate">
                        {selectedModel?.displayName ??
                            (isLoading ? "Loading models" : "Select model")}
                        {selectedModel && (
                            <span className="text-dark-300">
                                {supportsFastMode &&
                                    selection.speed === "fast" && <> · Fast</>}
                                {selectedReasoningEfforts.length > 0 &&
                                    currentEffort && (
                                        <>
                                            {" "}
                                            · {formatEffortLabel(currentEffort)}
                                        </>
                                    )}
                            </span>
                        )}
                    </span>
                    <CaretUpDownIcon className="size-3.5 shrink-0 text-dark-300" />
                </Button>
            </PopoverTrigger>

            <PopoverContent
                align="start"
                side="top"
                sideOffset={8}
                className="relative w-56 overflow-visible p-0"
            >
                <div className="border-b border-dark-700 p-1 space-y-0.5">
                    {supportsFastMode && (
                        <Popover open={speedOpen} onOpenChange={setSpeedOpen}>
                            <PopoverTrigger className="flex w-full items-center justify-between rounded-sm px-2.5 py-1.5 text-left transition-colors hover:bg-dark-800">
                                <span className="text-xs text-dark-100">
                                    Speed
                                </span>
                                <div className="flex items-center gap-1 text-xs text-dark-300">
                                    <span>
                                        {formatSpeedLabel(selection.speed)}
                                    </span>
                                    <CaretRightIcon className="size-3 shrink-0" />
                                </div>
                            </PopoverTrigger>
                            <PopoverContent
                                side="right"
                                align="start"
                                sideOffset={8}
                                className="w-32 p-1"
                            >
                                <div className="space-y-0.5">
                                    {speedOptions.map((speed) => {
                                        const isActive =
                                            selection.speed === speed;
                                        return (
                                            <button
                                                key={speed}
                                                type="button"
                                                onClick={() => {
                                                    selectSpeed(speed);
                                                }}
                                                className={cn(
                                                    "flex w-full items-center justify-between rounded-sm px-2.5 py-1.5 text-xs transition-colors",
                                                    isActive
                                                        ? "bg-dark-800 text-dark-50"
                                                        : "text-dark-200 hover:bg-dark-800 hover:text-dark-50"
                                                )}
                                            >
                                                <span>
                                                    {formatSpeedLabel(speed)}
                                                </span>
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
                    )}

                    <Popover
                        open={reasoningOpen}
                        onOpenChange={setReasoningOpen}
                    >
                        <PopoverTrigger
                            disabled={selectedReasoningEfforts.length === 0}
                            className="flex w-full items-center justify-between rounded-sm px-2.5 py-1.5 text-left transition-colors hover:bg-dark-800 disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
                        >
                            <span className="text-xs text-dark-100">
                                Reasoning
                            </span>
                            <div className="flex items-center gap-1 text-xs text-dark-300">
                                <span>{formatEffortLabel(currentEffort)}</span>
                                <CaretRightIcon className="size-3 shrink-0" />
                            </div>
                        </PopoverTrigger>
                        <PopoverContent
                            side="right"
                            align="start"
                            sideOffset={8}
                            className="w-32 p-1"
                        >
                            <div className="space-y-0.5">
                                <div className="mb-1 flex items-center justify-between px-2.5 py-1">
                                    <span className="text-xs text-dark-200">
                                        Reasoning
                                    </span>
                                    <HotkeyShortcut
                                        combo={reasoningCycleHotkey}
                                    />
                                </div>

                                {selectedReasoningEfforts.map((effort) => {
                                    const isActive = currentEffort === effort;
                                    return (
                                        <button
                                            key={effort}
                                            type="button"
                                            onClick={() => {
                                                selectReasoningEffort(effort);
                                                setReasoningOpen(false);
                                            }}
                                            className={cn(
                                                "flex w-full items-center justify-between rounded-sm px-2.5 py-1.5 text-xs transition-colors",
                                                isActive
                                                    ? "bg-dark-800 text-dark-50"
                                                    : "text-dark-200 hover:bg-dark-800 hover:text-dark-50"
                                            )}
                                        >
                                            <span>
                                                {formatEffortLabel(effort)}
                                            </span>
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
                </div>

                <div className="border-b border-dark-700 p-1 space-y-0.5">
                    <div className="px-2.5 py-1 text-[10px] font-medium uppercase text-dark-200">
                        Subagents
                    </div>
                    <Popover
                        open={subagentModelOpen}
                        onOpenChange={setSubagentModelOpen}
                    >
                        <PopoverTrigger className="flex w-full items-center justify-between rounded-sm px-2.5 py-1.5 text-left transition-colors hover:bg-dark-800">
                            <span className="text-xs text-dark-100">Model</span>
                            <div className="flex min-w-0 items-center gap-1 text-xs text-dark-300">
                                <span className="max-w-[10rem] truncate">
                                    {selectedSubagentModel?.displayName ??
                                        "Select"}
                                </span>
                                <CaretRightIcon className="size-3 shrink-0" />
                            </div>
                        </PopoverTrigger>
                        <PopoverContent
                            side="right"
                            align="start"
                            sideOffset={8}
                            className="w-52 p-1"
                        >
                            <div className="max-h-60 overflow-y-auto space-y-0.5">
                                {models.map((model) => {
                                    const isActive =
                                        subagentSelection.modelId === model.id;
                                    return (
                                        <button
                                            key={model.id}
                                            type="button"
                                            onClick={() => {
                                                selectSubagentModel(model.id);
                                                setSubagentModelOpen(false);
                                            }}
                                            className={cn(
                                                "flex w-full items-center justify-between gap-3 rounded-sm px-2.5 py-1.5 text-left transition-colors hover:bg-dark-800",
                                                isActive
                                                    ? "bg-dark-800 text-dark-50"
                                                    : "text-dark-200"
                                            )}
                                        >
                                            <div className="flex min-w-0 items-center gap-2">
                                                <OpenAiLogoIcon
                                                    className={cn(
                                                        "size-3.5 shrink-0",
                                                        isActive
                                                            ? "text-dark-100"
                                                            : "text-dark-300"
                                                    )}
                                                />
                                                <span
                                                    className={cn(
                                                        "truncate text-xs",
                                                        isActive
                                                            ? "text-dark-50 font-medium"
                                                            : "text-dark-200"
                                                    )}
                                                >
                                                    {model.displayName}
                                                </span>
                                            </div>
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

                    <Popover
                        open={subagentReasoningOpen}
                        onOpenChange={setSubagentReasoningOpen}
                    >
                        <PopoverTrigger
                            disabled={
                                selectedSubagentReasoningEfforts.length === 0
                            }
                            className="flex w-full items-center justify-between rounded-sm px-2.5 py-1.5 text-left transition-colors hover:bg-dark-800 disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
                        >
                            <span className="text-xs text-dark-100">
                                Reasoning
                            </span>
                            <div className="flex items-center gap-1 text-xs text-dark-300">
                                <span>
                                    {formatEffortLabel(currentSubagentEffort)}
                                </span>
                                <CaretRightIcon className="size-3 shrink-0" />
                            </div>
                        </PopoverTrigger>
                        <PopoverContent
                            side="right"
                            align="start"
                            sideOffset={8}
                            className="w-32 p-1"
                        >
                            <div className="space-y-0.5">
                                {selectedSubagentReasoningEfforts.map(
                                    (effort) => {
                                        const isActive =
                                            currentSubagentEffort === effort;
                                        return (
                                            <button
                                                key={effort}
                                                type="button"
                                                onClick={() => {
                                                    selectSubagentReasoningEffort(
                                                        effort
                                                    );
                                                    setSubagentReasoningOpen(
                                                        false
                                                    );
                                                }}
                                                className={cn(
                                                    "flex w-full items-center justify-between rounded-sm px-2.5 py-1.5 text-xs transition-colors",
                                                    isActive
                                                        ? "bg-dark-800 text-dark-50"
                                                        : "text-dark-200 hover:bg-dark-800 hover:text-dark-50"
                                                )}
                                            >
                                                <span>
                                                    {formatEffortLabel(effort)}
                                                </span>
                                                {isActive && (
                                                    <CheckIcon
                                                        className="size-3 shrink-0 text-dark-100"
                                                        weight="bold"
                                                    />
                                                )}
                                            </button>
                                        );
                                    }
                                )}
                            </div>
                        </PopoverContent>
                    </Popover>
                </div>

                <div className="max-h-72 overflow-y-auto p-1.5">
                    {isLoading ? (
                        <div className="flex items-center gap-2 px-2 py-3 text-xs text-dark-300">
                            <SpinnerGapIcon className="size-3.5 animate-spin" />
                            Loading models…
                        </div>
                    ) : (
                        <div>
                            {models.map((model) => {
                                const isActive = selection.modelId === model.id;

                                return (
                                    <button
                                        key={model.id}
                                        type="button"
                                        onClick={() => selectModel(model.id)}
                                        className="flex w-full items-center justify-between gap-3 rounded-sm px-2.5 py-1.5 text-left transition-colors hover:bg-dark-800"
                                    >
                                        <div className="flex min-w-0 items-center gap-2">
                                            <OpenAiLogoIcon
                                                className={cn(
                                                    "size-3.5 shrink-0",
                                                    isActive
                                                        ? "text-dark-100"
                                                        : "text-dark-300"
                                                )}
                                            />
                                            <span
                                                className={cn(
                                                    "truncate text-xs",
                                                    isActive
                                                        ? "text-dark-50 font-medium"
                                                        : "text-dark-200"
                                                )}
                                            >
                                                {model.displayName}
                                            </span>
                                        </div>
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
                    )}
                </div>
            </PopoverContent>
        </Popover>
    );
}
