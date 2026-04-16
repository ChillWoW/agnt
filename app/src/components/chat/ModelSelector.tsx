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
    const {
        isLoading,
        models,
        selection,
        selectedModel,
        selectedReasoningEfforts,
        selectModel,
        selectSpeed,
        selectReasoningEffort
    } = useModelSelection({ workspaceId, conversationId });

    const currentEffort =
        selection.reasoningEffort ??
        selectedModel?.defaultEffort ??
        selectedReasoningEfforts[0] ??
        null;

    const speedOptions: ModelSpeed[] = ["standard", "fast"];
    const supportsFastMode = selectedModel?.supportsFastMode ?? false;

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger className="w-auto">
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 max-w-[13rem] gap-2 hover:bg-dark-800 text-dark-200"
                >
                    <OpenAiLogoIcon className="size-3.5 shrink-0" />
                    <span className="truncate">
                        {selectedModel?.displayName ??
                            (isLoading ? "Loading models" : "Select model")}
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
                                <span className="text-xs text-dark-100">Speed</span>
                                <div className="flex items-center gap-1 text-xs text-dark-300">
                                    <span>{formatSpeedLabel(selection.speed)}</span>
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
                                        const isActive = selection.speed === speed;
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
                                                <span>{formatSpeedLabel(speed)}</span>
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
