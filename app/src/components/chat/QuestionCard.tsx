import { useMemo, useState } from "react";
import {
    ArrowLeftIcon,
    ArrowRightIcon,
    ArrowUpIcon,
    XIcon
} from "@phosphor-icons/react";
import { Button } from "@/components/ui";
import {
    useQuestionStore,
    type QuestionSpec,
    type QuestionsRequest
} from "@/features/questions";
import { cn } from "@/lib/cn";

interface QuestionCardProps {
    workspaceId: string;
    conversationId: string;
    request: QuestionsRequest;
    queueLength?: number;
}

interface PerQuestionDraft {
    selected: string[];
    customActive: boolean;
    customText: string;
}

function makeInitialDraft(questions: QuestionSpec[]): PerQuestionDraft[] {
    return questions.map(() => ({
        selected: [],
        customActive: false,
        customText: ""
    }));
}

function toggleSelection(
    draft: PerQuestionDraft,
    spec: QuestionSpec,
    label: string
): PerQuestionDraft {
    if (spec.multiple) {
        const idx = draft.selected.indexOf(label);
        if (idx === -1) {
            return { ...draft, selected: [...draft.selected, label] };
        }
        const next = draft.selected.slice();
        next.splice(idx, 1);
        return { ...draft, selected: next };
    }

    const already = draft.selected[0] === label && draft.selected.length === 1;
    // Single-select: picking a real option deactivates the "Type your own"
    // row so we never end up with two active answers at once.
    return {
        ...draft,
        selected: already ? [] : [label],
        customActive: false,
        customText: ""
    };
}

function draftHasAnswer(draft: PerQuestionDraft): boolean {
    if (draft.selected.length > 0) return true;
    if (draft.customActive && draft.customText.trim().length > 0) return true;
    return false;
}

function buildAnswers(
    questions: QuestionSpec[],
    drafts: PerQuestionDraft[]
): string[][] {
    return questions.map((spec, idx) => {
        const draft = drafts[idx];
        if (!draft) return [];

        if (spec.multiple) {
            const answers: string[] = [...draft.selected];
            const custom = draft.customText.trim();
            if (draft.customActive && custom.length > 0) {
                answers.push(custom);
            }
            return answers;
        }

        if (draft.customActive) {
            const custom = draft.customText.trim();
            if (custom.length > 0) return [custom];
        }
        if (draft.selected.length > 0) {
            return [draft.selected[0]!];
        }
        return [];
    });
}

interface SelectIndicatorProps {
    multiple: boolean;
    selected: boolean;
}

function SelectIndicator({ multiple, selected }: SelectIndicatorProps) {
    if (multiple) {
        return (
            <span
                className={cn(
                    "flex size-[14px] shrink-0 items-center justify-center rounded-[3px] ring-1 ring-inset transition-colors",
                    selected
                        ? "bg-primary-100 ring-primary-100"
                        : "bg-transparent ring-dark-600"
                )}
            >
                {selected && (
                    <svg
                        viewBox="0 0 12 12"
                        className="size-2.5 text-dark-950"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    >
                        <polyline points="2,6.5 5,9 10,3.5" />
                    </svg>
                )}
            </span>
        );
    }

    return (
        <span
            className={cn(
                "flex size-[14px] shrink-0 items-center justify-center rounded-full ring-1 ring-inset transition-colors",
                selected
                    ? "ring-primary-100"
                    : "ring-dark-600"
            )}
        >
            {selected && (
                <span className="size-[7px] rounded-full bg-primary-100" />
            )}
        </span>
    );
}

interface OptionRowProps {
    label: string;
    description: string;
    selected: boolean;
    multiple: boolean;
    disabled: boolean;
    onToggle: () => void;
    last?: boolean;
}

function OptionRow({
    label,
    description,
    selected,
    multiple,
    disabled,
    onToggle,
    last
}: OptionRowProps) {
    return (
        <button
            type="button"
            disabled={disabled}
            onClick={onToggle}
            className={cn(
                "group flex w-full items-start gap-2.5 px-2.5 py-2 text-left outline-none transition-colors",
                !last && "border-b border-dark-800",
                "hover:bg-dark-850/60",
                "focus-visible:bg-dark-850",
                "disabled:cursor-not-allowed disabled:opacity-50"
            )}
        >
            <span className="mt-[3px]">
                <SelectIndicator multiple={multiple} selected={selected} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span
                    className={cn(
                        "text-xs font-medium transition-colors",
                        selected ? "text-dark-50" : "text-dark-100"
                    )}
                >
                    {label}
                </span>
                {description.length > 0 && (
                    <span className="text-[11px] leading-snug text-dark-300">
                        {description}
                    </span>
                )}
            </span>
        </button>
    );
}

interface CustomRowProps {
    active: boolean;
    text: string;
    disabled: boolean;
    onActivate: () => void;
    onDeactivate: () => void;
    onTextChange: (value: string) => void;
    last?: boolean;
}

function CustomRow({
    active,
    text,
    disabled,
    onActivate,
    onDeactivate,
    onTextChange,
    last
}: CustomRowProps) {
    const handleToggle = () => {
        if (active) {
            onDeactivate();
        } else {
            onActivate();
        }
    };

    const handleBlur = () => {
        // If the user activated "Type your own" but never typed anything,
        // blurring the input should un-tick the row so we don't end up
        // with a ghost active answer next to a real selection.
        if (active && text.trim().length === 0) {
            onDeactivate();
        }
    };

    return (
        <div
            className={cn(
                "flex items-start gap-2.5 px-2.5 py-2 transition-colors",
                !last && "border-b border-dark-800",
                active ? "bg-dark-850/40" : "hover:bg-dark-850/60"
            )}
        >
            <button
                type="button"
                disabled={disabled}
                onClick={handleToggle}
                className={cn(
                    "mt-[3px] outline-none disabled:cursor-not-allowed disabled:opacity-50",
                    "focus-visible:ring-1 focus-visible:ring-dark-400 focus-visible:rounded-full"
                )}
                aria-pressed={active}
                aria-label={active ? "Clear custom answer" : "Type your own answer"}
            >
                <SelectIndicator multiple={false} selected={active} />
            </button>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
                <button
                    type="button"
                    disabled={disabled}
                    onClick={handleToggle}
                    className={cn(
                        "self-start text-left text-xs font-medium outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                        active ? "text-dark-50" : "text-dark-100 hover:text-dark-50"
                    )}
                >
                    Type your own answer
                </button>
                <input
                    type="text"
                    disabled={disabled}
                    value={text}
                    onFocus={() => {
                        if (!active) onActivate();
                    }}
                    onBlur={handleBlur}
                    onChange={(e) => onTextChange(e.target.value)}
                    placeholder="Type your answer…"
                    className={cn(
                        "w-full bg-transparent text-[11px] leading-snug outline-none transition-colors",
                        "placeholder:text-dark-400 disabled:cursor-not-allowed",
                        active ? "text-dark-50" : "text-dark-300"
                    )}
                />
            </div>
        </div>
    );
}

interface ProgressLinesProps {
    total: number;
    currentIndex: number;
    answered: boolean[];
}

function ProgressLines({ total, currentIndex, answered }: ProgressLinesProps) {
    return (
        <div
            className="flex items-center gap-1"
            role="progressbar"
            aria-valuemin={1}
            aria-valuemax={total}
            aria-valuenow={currentIndex + 1}
        >
            {Array.from({ length: total }).map((_, i) => {
                const isCurrent = i === currentIndex;
                const isAnswered = answered[i] === true;
                return (
                    <span
                        key={i}
                        className={cn(
                            "h-[2px] w-4 rounded-full transition-colors",
                            isCurrent
                                ? "bg-primary-100"
                                : isAnswered
                                  ? "bg-dark-300"
                                  : "bg-dark-700"
                        )}
                    />
                );
            })}
        </div>
    );
}

export function QuestionCard({
    workspaceId,
    conversationId,
    request,
    queueLength = 1
}: QuestionCardProps) {
    const [drafts, setDrafts] = useState<PerQuestionDraft[]>(() =>
        makeInitialDraft(request.questions)
    );
    const [currentIndex, setCurrentIndex] = useState(0);

    const respond = useQuestionStore((s) => s.respond);
    const cancel = useQuestionStore((s) => s.cancel);
    const responding = useQuestionStore((s) =>
        Boolean(s.respondingIds[request.id])
    );

    const total = request.questions.length;
    const isFirst = currentIndex === 0;
    const isLast = currentIndex === total - 1;
    const spec = request.questions[currentIndex];
    const draft = drafts[currentIndex] ?? {
        selected: [],
        customActive: false,
        customText: ""
    };

    const answered = useMemo(
        () => drafts.map((d) => draftHasAnswer(d)),
        [drafts]
    );
    const allAnswered = useMemo(
        () => answered.every(Boolean),
        [answered]
    );
    const currentAnswered = answered[currentIndex] === true;
    const queued = Math.max(queueLength - 1, 0);

    if (!spec) return null;

    const handleDraftChange = (next: PerQuestionDraft) => {
        setDrafts((prev) => {
            const copy = prev.slice();
            copy[currentIndex] = next;
            return copy;
        });
    };

    const handleToggle = (label: string) =>
        handleDraftChange(toggleSelection(draft, spec, label));

    const handleCustomActivate = () =>
        handleDraftChange({
            ...draft,
            customActive: true,
            // Single-select: activating "Type your own" replaces any real
            // selection so only one answer is ever ticked at once.
            selected: spec.multiple ? draft.selected : []
        });

    const handleCustomDeactivate = () =>
        handleDraftChange({
            ...draft,
            customActive: false,
            customText: ""
        });

    const handleCustomText = (value: string) =>
        handleDraftChange({ ...draft, customText: value, customActive: true });

    const handleCancel = () => {
        if (responding) return;
        // Cancelling resolves the tool call with `cancelled: true` so the
        // LLM can continue the task on its own instead of being aborted.
        void cancel(workspaceId, conversationId, request.id);
    };

    const handleBack = () => {
        if (isFirst || responding) return;
        setCurrentIndex((i) => Math.max(0, i - 1));
    };

    const handleNext = () => {
        if (!currentAnswered || responding) return;
        setCurrentIndex((i) => Math.min(total - 1, i + 1));
    };

    const handleSubmit = () => {
        if (!allAnswered || responding) return;
        const answers = buildAnswers(request.questions, drafts);
        void respond(workspaceId, conversationId, request.id, answers);
    };

    return (
        <div className="flex flex-col">
            <div className="flex min-w-0 items-center gap-2 border-b border-dark-800 px-2.5 py-2">
                <span className="shrink-0 text-xs font-medium text-dark-50">
                    {total === 1
                        ? spec.header
                        : `${currentIndex + 1} of ${total} questions`}
                </span>
                {queued > 0 && (
                    <span className="shrink-0 rounded-md bg-dark-800 px-1.5 py-0.5 text-[10px] font-medium text-dark-200">
                        +{queued} more
                    </span>
                )}
                <div className="ml-auto flex items-center gap-2">
                    {total > 1 && (
                        <ProgressLines
                            total={total}
                            currentIndex={currentIndex}
                            answered={answered}
                        />
                    )}
                </div>
            </div>

            <div className="flex flex-col gap-1 px-2.5 pt-2.5 pb-1.5">
                <p className="text-xs font-medium leading-relaxed text-dark-50">
                    {spec.question}
                </p>
                <p className="text-[11px] text-dark-300">
                    {spec.multiple
                        ? "Select one or more answers"
                        : "Select one answer"}
                </p>
            </div>

            <div className="flex max-h-[260px] flex-col overflow-y-auto border-t border-dark-800">
                {spec.options.map((opt, optIdx) => (
                    <OptionRow
                        key={`${opt.label}-${optIdx}`}
                        label={opt.label}
                        description={opt.description}
                        selected={draft.selected.includes(opt.label)}
                        multiple={spec.multiple}
                        disabled={responding}
                        onToggle={() => handleToggle(opt.label)}
                    />
                ))}
                <CustomRow
                    active={draft.customActive}
                    text={draft.customText}
                    disabled={responding}
                    onActivate={handleCustomActivate}
                    onDeactivate={handleCustomDeactivate}
                    onTextChange={handleCustomText}
                    last
                />
            </div>

            <div className="flex h-11 items-center gap-1.5 border-t border-dark-800 px-2.5">
                <Button
                    variant="ghost"
                    size="sm"
                    disabled={responding}
                    onClick={handleCancel}
                    className="h-7 gap-1 text-dark-200 hover:text-dark-50"
                >
                    <XIcon
                        className="size-3"
                        weight="bold"
                    />
                    <span>Cancel</span>
                </Button>
                <div className="ml-auto flex items-center gap-1.5">
                    {!isFirst && (
                        <Button
                            variant="ghost"
                            size="sm"
                            disabled={responding}
                            onClick={handleBack}
                            className="h-7 gap-1 text-dark-200 hover:text-dark-50"
                        >
                            <ArrowLeftIcon
                                className="size-3"
                                weight="bold"
                            />
                            <span>Back</span>
                        </Button>
                    )}
                    {isLast ? (
                        <Button
                            variant="primary"
                            size="sm"
                            disabled={!allAnswered || responding}
                            loading={responding}
                            onClick={handleSubmit}
                            className="h-7 gap-1.5"
                        >
                            <span>Submit</span>
                            <ArrowUpIcon
                                className="size-3"
                                weight="bold"
                            />
                        </Button>
                    ) : (
                        <Button
                            variant="primary"
                            size="sm"
                            disabled={!currentAnswered || responding}
                            onClick={handleNext}
                            className="h-7 gap-1.5"
                        >
                            <span>Next</span>
                            <ArrowRightIcon
                                className="size-3"
                                weight="bold"
                            />
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
}
