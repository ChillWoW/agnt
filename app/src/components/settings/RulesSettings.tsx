import {
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    type KeyboardEvent
} from "react";
import { PlusIcon, TrashIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useRules } from "@/features/rules";
import type { Rule } from "@/typings/rules";
import { cn } from "@/lib/cn";
import {
    Button,
    Modal,
    ModalClose,
    ModalContent,
    ModalDescription,
    ModalTitle
} from "@/components/ui";

// ─── Rules settings panel ─────────────────────────────────────────────────────
//
// Cursor-style: an inline composer (toggled via "+ New") sits above a flat,
// divider-separated list of rule rows. Clicking a row opens it for inline
// editing in place. Saves are explicit (the "Done" button) — no debounced
// auto-save — which keeps the model from churning the prompt cache while
// the user is mid-thought.

const PLACEHOLDER = "Style request, response language, tone…";

type Mode =
    | { kind: "idle" }
    | { kind: "creating" }
    | { kind: "editing"; id: string };

function autoGrow(textarea: HTMLTextAreaElement | null): void {
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
}

function previewLine(body: string): string {
    const trimmed = body.trim();
    if (!trimmed) return "Empty rule";
    const firstLine = trimmed.split(/\r?\n/, 1)[0]?.trim() ?? "";
    return firstLine || "Empty rule";
}

interface InlineEditorProps {
    initialDraft: string;
    placeholder?: string;
    saving?: boolean;
    deleting?: boolean;
    autoFocus?: boolean;
    onCancel: () => void;
    onSave: (body: string) => Promise<void> | void;
    onDelete?: () => Promise<void> | void;
    submitLabel?: string;
}

function InlineEditor({
    initialDraft,
    placeholder = PLACEHOLDER,
    saving = false,
    deleting = false,
    autoFocus = true,
    onCancel,
    onSave,
    onDelete,
    submitLabel = "Done"
}: InlineEditorProps) {
    const [draft, setDraft] = useState(initialDraft);
    const taRef = useRef<HTMLTextAreaElement | null>(null);

    useLayoutEffect(() => {
        autoGrow(taRef.current);
    }, [draft]);

    useEffect(() => {
        if (!autoFocus) return;
        const ta = taRef.current;
        if (!ta) return;
        ta.focus();
        const len = ta.value.length;
        ta.setSelectionRange(len, len);
    }, [autoFocus]);

    const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
            return;
        }
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            if (canSave) void onSave(draft);
        }
    };

    const trimmed = draft.trim();
    const canSave =
        trimmed.length > 0 && trimmed !== initialDraft.trim() && !saving;

    return (
        <div
            className={cn(
                "rounded-lg border border-dark-700 bg-dark-900 transition-colors",
                "focus-within:border-dark-500 focus-within:bg-dark-900"
            )}
        >
            <textarea
                ref={taRef}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={placeholder}
                spellCheck={false}
                rows={3}
                className={cn(
                    "block w-full resize-none bg-transparent px-4 pt-3 pb-2 text-[13px] leading-relaxed text-dark-50 outline-none",
                    "placeholder:text-dark-500"
                )}
            />
            <div className="flex items-center justify-between gap-2 px-2 pt-1 pb-2">
                <div className="flex items-center">
                    {onDelete && (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void onDelete()}
                            loading={deleting}
                            disabled={saving}
                            className="text-red-300 hover:bg-red-500/10 hover:text-red-200"
                        >
                            <TrashIcon size={12} />
                            Delete
                        </Button>
                    )}
                </div>
                <div className="flex items-center gap-1">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={onCancel}
                        disabled={saving || deleting}
                    >
                        Cancel
                    </Button>
                    <Button
                        variant="primary"
                        size="sm"
                        onClick={() => void onSave(draft)}
                        loading={saving}
                        disabled={!canSave}
                    >
                        {submitLabel}
                    </Button>
                </div>
            </div>
        </div>
    );
}

interface RuleRowProps {
    rule: Rule;
    interactive: boolean;
    onClick: () => void;
}

function RuleRow({ rule, interactive, onClick }: RuleRowProps) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={!interactive}
            className={cn(
                "block w-full border-b border-dark-700 bg-dark-900 p-2.5 text-left transition-colors last:border-b-0",
                interactive
                    ? "cursor-pointer hover:bg-dark-850"
                    : "cursor-default opacity-60"
            )}
        >
            <span className="line-clamp-1 text-xs text-dark-100">
                {previewLine(rule.body)}
            </span>
        </button>
    );
}

interface ConfirmDeleteRuleDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    preview: string;
    deleting: boolean;
    onConfirm: () => void;
}

function ConfirmDeleteRuleDialog({
    open,
    onOpenChange,
    preview,
    deleting,
    onConfirm
}: ConfirmDeleteRuleDialogProps) {
    return (
        <Modal open={open} onOpenChange={onOpenChange}>
            <ModalContent className="p-5">
                <ModalTitle>Delete this rule?</ModalTitle>
                <ModalDescription>
                    &quot;{preview}&quot; will be removed from the system prompt.
                    This cannot be undone.
                </ModalDescription>
                <div className="mt-5 flex justify-end gap-2">
                    <ModalClose className="text-sm" disabled={deleting}>
                        Cancel
                    </ModalClose>
                    <button
                        type="button"
                        onClick={onConfirm}
                        disabled={deleting}
                        className={cn(
                            "inline-flex items-center justify-center rounded-md px-3 py-1.5 text-sm text-white transition-colors",
                            "bg-red-500/90 hover:bg-red-500",
                            "disabled:cursor-not-allowed disabled:opacity-60"
                        )}
                    >
                        {deleting ? "Deleting…" : "Delete"}
                    </button>
                </div>
            </ModalContent>
        </Modal>
    );
}

export function RulesSettings() {
    const { rules, isLoading, error, createRule, updateRule, deleteRule } =
        useRules();
    const [mode, setMode] = useState<Mode>({ kind: "idle" });
    const [busyId, setBusyId] = useState<string | "new" | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

    const pendingDeleteRule = pendingDeleteId
        ? rules.find((r) => r.id === pendingDeleteId) ?? null
        : null;

    const idle = mode.kind === "idle";

    const handleNew = () => {
        if (!idle) return;
        setMode({ kind: "creating" });
    };

    const handleEdit = (rule: Rule) => {
        if (!idle) return;
        setMode({ kind: "editing", id: rule.id });
    };

    const handleCancel = () => setMode({ kind: "idle" });

    const handleSaveNew = async (body: string) => {
        const trimmed = body.trim();
        if (!trimmed) {
            setMode({ kind: "idle" });
            return;
        }
        setBusyId("new");
        try {
            await createRule(body);
            setMode({ kind: "idle" });
        } finally {
            setBusyId(null);
        }
    };

    const handleSaveExisting = async (id: string, body: string) => {
        setBusyId(id);
        try {
            await updateRule(id, body);
            setMode({ kind: "idle" });
        } finally {
            setBusyId(null);
        }
    };

    const handleRequestDelete = (id: string) => {
        setPendingDeleteId(id);
    };

    const handleConfirmDelete = async () => {
        if (!pendingDeleteId) return;
        const id = pendingDeleteId;
        setDeletingId(id);
        try {
            await deleteRule(id);
            setMode({ kind: "idle" });
            setPendingDeleteId(null);
        } finally {
            setDeletingId(null);
        }
    };

    return (
        <div className="mx-auto w-full max-w-2xl px-10 pt-14 pb-16">
            <div className="mb-2 flex items-center justify-between gap-4">
                <h1 className="text-2xl font-medium tracking-tight text-dark-50">
                    Rules
                </h1>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleNew}
                    disabled={!idle}
                >
                    <PlusIcon size={12} weight="bold" />
                    New
                </Button>
            </div>
            <p className="mb-6 max-w-prose text-sm leading-relaxed text-dark-300">
                Use rules to guide agent behavior — like coding standards, tone,
                or recurring instructions. Every rule is global and always-on,
                injected at the end of the system prompt.
            </p>

            {error && (
                <div className="mb-4 flex items-center gap-2 rounded-md border border-red-900 bg-red-950 px-4 py-3">
                    <WarningCircleIcon
                        size={13}
                        className="shrink-0 text-red-400"
                    />
                    <span className="text-[13px] text-red-300">{error}</span>
                </div>
            )}

            {mode.kind === "creating" && (
                <div className="mb-4">
                    <InlineEditor
                        initialDraft=""
                        placeholder={PLACEHOLDER}
                        saving={busyId === "new"}
                        onCancel={handleCancel}
                        onSave={handleSaveNew}
                    />
                </div>
            )}

            {isLoading && rules.length === 0 ? (
                <div className="rounded-md border border-dashed border-dark-700 bg-dark-900/50 px-6 py-12 text-center text-[13px] text-dark-400">
                    Loading…
                </div>
            ) : rules.length > 0 ? (
                <div className="flex flex-col">
                    {rules.map((rule) => {
                        const isEditing =
                            mode.kind === "editing" && mode.id === rule.id;
                        if (isEditing) {
                            return (
                                <div
                                    key={rule.id}
                                    className="border-b border-dark-800 py-2 last:border-b-0"
                                >
                                    <InlineEditor
                                        initialDraft={rule.body}
                                        saving={busyId === rule.id}
                                        deleting={deletingId === rule.id}
                                        onCancel={handleCancel}
                                        onSave={(body) =>
                                            handleSaveExisting(rule.id, body)
                                        }
                                        onDelete={() =>
                                            handleRequestDelete(rule.id)
                                        }
                                        submitLabel="Save"
                                    />
                                </div>
                            );
                        }
                        return (
                            <RuleRow
                                key={rule.id}
                                rule={rule}
                                interactive={idle}
                                onClick={() => handleEdit(rule)}
                            />
                        );
                    })}
                </div>
            ) : null}

            <ConfirmDeleteRuleDialog
                open={pendingDeleteId !== null}
                onOpenChange={(open) => {
                    if (!open && deletingId === null) {
                        setPendingDeleteId(null);
                    }
                }}
                preview={
                    pendingDeleteRule ? previewLine(pendingDeleteRule.body) : ""
                }
                deleting={deletingId !== null && deletingId === pendingDeleteId}
                onConfirm={() => void handleConfirmDelete()}
            />
        </div>
    );
}
