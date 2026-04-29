import { useCallback, useEffect, useRef, useState } from "react";
import { CheckIcon, XIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { Button, Tooltip } from "@/components/ui";

interface MessageEditorProps {
    initialContent: string;
    /**
     * Called when the user commits the edit. The caller is responsible for
     * dispatching the actual edit-and-regenerate stream.
     */
    onSave: (content: string) => void;
    onCancel: () => void;
    /** True while the parent is dispatching the edit; locks the controls. */
    isSubmitting?: boolean;
}

/**
 * Inline editor for the latest user message. Renders a textarea pre-filled
 * with the message content, plus Save (Enter) / Cancel (Escape) controls.
 * Used by `MessageBubble` when the user clicks the edit pencil on the last
 * user bubble.
 */
export function MessageEditor({
    initialContent,
    onSave,
    onCancel,
    isSubmitting = false
}: MessageEditorProps) {
    const [draft, setDraft] = useState(initialContent);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const adjustHeight = useCallback(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.style.height = "auto";
        el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
    }, []);

    useEffect(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        // Place caret at the end so the user can append immediately.
        const len = el.value.length;
        el.setSelectionRange(len, len);
        adjustHeight();
    }, [adjustHeight]);

    useEffect(() => {
        adjustHeight();
    }, [draft, adjustHeight]);

    const trimmed = draft.trim();
    const canSave =
        !isSubmitting && trimmed.length > 0 && trimmed !== initialContent.trim();

    const handleKeyDown = useCallback(
        (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
            if (event.key === "Escape") {
                event.preventDefault();
                onCancel();
                return;
            }
            if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
            ) {
                event.preventDefault();
                if (canSave) {
                    onSave(trimmed);
                }
            }
        },
        [canSave, onCancel, onSave, trimmed]
    );

    return (
        <div className="flex w-full min-w-0 flex-col gap-1.5 py-1">
            <textarea
                ref={textareaRef}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isSubmitting}
                className={cn(
                    "w-full resize-none rounded bg-transparent text-sm text-dark-50 outline-none placeholder:text-dark-300",
                    "min-h-[1.25rem] leading-relaxed"
                )}
                placeholder="Edit your message…"
                rows={1}
            />
            <div className="flex items-center justify-end gap-1.5">
                <Tooltip content="Cancel (Esc)" side="top">
                    <Button
                        type="button"
                        variant="ghost"
                        onClick={onCancel}
                        disabled={isSubmitting}
                        className="size-6 shrink-0 rounded p-0 text-dark-200 hover:bg-dark-800 hover:text-dark-50"
                    >
                        <XIcon className="size-3" weight="bold" />
                    </Button>
                </Tooltip>
                <Tooltip content="Save and regenerate (Enter)" side="top">
                    <Button
                        type="button"
                        variant="ghost"
                        onClick={() => canSave && onSave(trimmed)}
                        disabled={!canSave}
                        className={cn(
                            "size-6 shrink-0 rounded p-0",
                            canSave
                                ? "bg-blue-500/15 text-blue-400 hover:bg-blue-500/25 hover:text-blue-300"
                                : "text-dark-400"
                        )}
                    >
                        <CheckIcon className="size-3" weight="bold" />
                    </Button>
                </Tooltip>
            </div>
        </div>
    );
}
