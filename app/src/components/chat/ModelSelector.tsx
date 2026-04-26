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
import type {
    ReasoningEffort,
    ModelSpeed,
    ModelCatalogEntry
} from "@/features/models";

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

function buildSummary(
    modelName: string | undefined,
    effort: ReasoningEffort | null,
    speedSuffix?: string
) {
    if (!modelName) {
        return "Select";
    }
    const parts = [modelName];
    if (speedSuffix) {
        parts.push(speedSuffix);
    }
    if (effort) {
        parts.push(formatEffortLabel(effort));
    }
    return parts.join(" · ");
}

export function ModelSelector({
    workspaceId,
    conversationId
}: ModelSelectorProps) {
    const [open, setOpen] = useState(false);
    const [agentOpen, setAgentOpen] = useState(false);
    const [subagentOpen, setSubagentOpen] = useState(false);
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

    const agentSpeedSuffix =
        supportsFastMode && selection.speed === "fast" ? "Fast" : undefined;

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
                className="relative w-64 overflow-visible p-1"
            >
                <div className="space-y-0.5">
                    <Popover open={agentOpen} onOpenChange={setAgentOpen}>
                        <PopoverTrigger className="flex w-full items-center justify-between gap-3 rounded-sm px-2.5 py-1.5 text-left transition-colors hover:bg-dark-800">
                            <span className="text-xs text-dark-100">Agent</span>
                            <div className="flex min-w-0 items-center gap-1 text-xs text-dark-300">
                                <span className="truncate">
                                    {buildSummary(
                                        selectedModel?.displayName,
                                        selectedReasoningEfforts.length > 0
                                            ? currentEffort
                                            : null,
                                        agentSpeedSuffix
                                    )}
                                </span>
                                <CaretRightIcon className="size-3 shrink-0" />
                            </div>
                        </PopoverTrigger>
                        <PopoverContent
                            side="right"
                            align="start"
                            sideOffset={8}
                            className="w-60 overflow-visible p-0"
                        >
                            <AgentSubmenu
                                isLoading={isLoading}
                                models={models}
                                activeModelId={selection.modelId}
                                onSelectModel={selectModel}
                                reasoningEfforts={selectedReasoningEfforts}
                                activeEffort={currentEffort}
                                onSelectEffort={selectReasoningEffort}
                                showSpeed={supportsFastMode}
                                activeSpeed={selection.speed}
                                onSelectSpeed={selectSpeed}
                                reasoningCycleHotkey={reasoningCycleHotkey}
                            />
                        </PopoverContent>
                    </Popover>

                    <Popover
                        open={subagentOpen}
                        onOpenChange={setSubagentOpen}
                    >
                        <PopoverTrigger className="flex w-full items-center justify-between gap-3 rounded-sm px-2.5 py-1.5 text-left transition-colors hover:bg-dark-800">
                            <span className="text-xs text-dark-100">
                                Subagent
                            </span>
                            <div className="flex min-w-0 items-center gap-1 text-xs text-dark-300">
                                <span className="truncate">
                                    {buildSummary(
                                        selectedSubagentModel?.displayName,
                                        selectedSubagentReasoningEfforts.length >
                                            0
                                            ? currentSubagentEffort
                                            : null
                                    )}
                                </span>
                                <CaretRightIcon className="size-3 shrink-0" />
                            </div>
                        </PopoverTrigger>
                        <PopoverContent
                            side="right"
                            align="start"
                            sideOffset={8}
                            className="w-60 overflow-visible p-0"
                        >
                            <AgentSubmenu
                                isLoading={isLoading}
                                models={models}
                                activeModelId={subagentSelection.modelId}
                                onSelectModel={selectSubagentModel}
                                reasoningEfforts={
                                    selectedSubagentReasoningEfforts
                                }
                                activeEffort={currentSubagentEffort}
                                onSelectEffort={selectSubagentReasoningEffort}
                                showSpeed={false}
                                activeSpeed="standard"
                                onSelectSpeed={() => undefined}
                            />
                        </PopoverContent>
                    </Popover>
                </div>
            </PopoverContent>
        </Popover>
    );
}

interface AgentSubmenuProps {
    isLoading: boolean;
    models: ModelCatalogEntry[];
    activeModelId: string | null;
    onSelectModel: (modelId: string) => void;
    reasoningEfforts: ReasoningEffort[];
    activeEffort: ReasoningEffort | null;
    onSelectEffort: (effort: ReasoningEffort) => void;
    showSpeed: boolean;
    activeSpeed: ModelSpeed;
    onSelectSpeed: (speed: ModelSpeed) => void;
    reasoningCycleHotkey?: string | null;
}

function AgentSubmenu({
    isLoading,
    models,
    activeModelId,
    onSelectModel,
    reasoningEfforts,
    activeEffort,
    onSelectEffort,
    showSpeed,
    activeSpeed,
    onSelectSpeed,
    reasoningCycleHotkey
}: AgentSubmenuProps) {
    const [speedOpen, setSpeedOpen] = useState(false);
    const [reasoningOpen, setReasoningOpen] = useState(false);
    const speedOptions: ModelSpeed[] = ["standard", "fast"];
    const hasReasoning = reasoningEfforts.length > 0;
    const showControls = showSpeed || hasReasoning;

    return (
        <div className="flex flex-col">
            {showControls && (
                <div className="border-b border-dark-700 p-1 space-y-0.5">
                    {showSpeed && (
                        <Popover open={speedOpen} onOpenChange={setSpeedOpen}>
                            <PopoverTrigger className="flex w-full items-center justify-between rounded-sm px-2.5 py-1.5 text-left transition-colors hover:bg-dark-800">
                                <span className="text-xs text-dark-100">
                                    Speed
                                </span>
                                <div className="flex items-center gap-1 text-xs text-dark-300">
                                    <span>{formatSpeedLabel(activeSpeed)}</span>
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
                                        const isActive = activeSpeed === speed;
                                        return (
                                            <button
                                                key={speed}
                                                type="button"
                                                onClick={() => {
                                                    onSelectSpeed(speed);
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
                            disabled={!hasReasoning}
                            className="flex w-full items-center justify-between rounded-sm px-2.5 py-1.5 text-left transition-colors hover:bg-dark-800 disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
                        >
                            <span className="text-xs text-dark-100">
                                Reasoning
                            </span>
                            <div className="flex items-center gap-1 text-xs text-dark-300">
                                <span>{formatEffortLabel(activeEffort)}</span>
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
                                {reasoningCycleHotkey && (
                                    <div className="mb-1 flex items-center justify-between px-2.5 py-1">
                                        <span className="text-xs text-dark-200">
                                            Reasoning
                                        </span>
                                        <HotkeyShortcut
                                            combo={reasoningCycleHotkey}
                                        />
                                    </div>
                                )}

                                {reasoningEfforts.map((effort) => {
                                    const isActive = activeEffort === effort;
                                    return (
                                        <button
                                            key={effort}
                                            type="button"
                                            onClick={() => {
                                                onSelectEffort(effort);
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
            )}

            <div className="p-1 space-y-0.5">
                <div className="px-2.5 pt-1 pb-0.5 text-[10px] font-medium uppercase tracking-wide text-dark-300">
                    Model
                </div>
                <div className="max-h-72 overflow-y-auto space-y-0.5">
                    {isLoading ? (
                        <div className="flex items-center gap-2 px-2 py-3 text-xs text-dark-300">
                            <SpinnerGapIcon className="size-3.5 animate-spin" />
                            Loading models…
                        </div>
                    ) : (
                        models.map((model) => {
                            const isActive = activeModelId === model.id;
                            return (
                                <button
                                    key={model.id}
                                    type="button"
                                    onClick={() => onSelectModel(model.id)}
                                    className={cn(
                                        "flex w-full items-center justify-between gap-3 rounded-sm px-2.5 py-1.5 text-left transition-colors hover:bg-dark-800",
                                        isActive ? "bg-dark-800" : ""
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
                        })
                    )}
                </div>
            </div>
        </div>
    );
}
