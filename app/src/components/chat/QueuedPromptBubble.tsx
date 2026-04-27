import { ClockIcon, XIcon } from "@phosphor-icons/react";
import { Tooltip } from "@/components/ui";
import { usePromptQueueStore } from "@/features/conversations";
import type { QueuedPrompt } from "@/features/conversations";
import { MessageText } from "./MessageText";

interface QueuedPromptBubbleProps {
    queued: QueuedPrompt;
    conversationId: string;
}

/**
 * Ghost user-message bubble for prompts the user submitted while a previous
 * turn was still streaming. Visually mirrors `MessageBubble` for `role:user`
 * but at reduced opacity, with a "Queued" tag and an inline remove button.
 *
 * The actual send happens in `runConversationStream`'s `finally` (see
 * `conversation-store.ts`), which FIFO-drains `usePromptQueueStore` once the
 * in-flight controller is gone.
 */
export function QueuedPromptBubble({
    queued,
    conversationId
}: QueuedPromptBubbleProps) {
    const remove = usePromptQueueStore((s) => s.remove);

    const hasContent = queued.content.trim().length > 0;
    const skillCount = queued.useSkillNames?.length ?? 0;
    const attachmentCount = queued.attachmentIds.length;

    return (
        <div className="group/queued mb-4 flex justify-end">
            <div className="flex max-w-[85%] flex-col items-end gap-1 opacity-60 transition-opacity hover:opacity-90">
                <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-dark-300">
                    <ClockIcon className="size-3" weight="bold" />
                    <span>Queued</span>
                </div>
                <div className="relative min-w-0 rounded-md border border-dashed border-dark-700 bg-dark-850 px-2.5 py-0.5 text-xs leading-relaxed text-dark-50">
                    {hasContent ? (
                        <MessageText
                            content={queued.content}
                            className="py-1 text-dark-50"
                        />
                    ) : (
                        <div className="py-1 text-dark-300 italic">
                            (empty message)
                        </div>
                    )}
                    {(skillCount > 0 || attachmentCount > 0) && (
                        <div className="mb-1 mt-0.5 flex flex-wrap gap-1 text-[10px] text-dark-300">
                            {attachmentCount > 0 && (
                                <span>
                                    {attachmentCount} attachment
                                    {attachmentCount === 1 ? "" : "s"}
                                </span>
                            )}
                            {skillCount > 0 && (
                                <span>
                                    {skillCount} skill
                                    {skillCount === 1 ? "" : "s"}
                                </span>
                            )}
                        </div>
                    )}

                    <div className="pointer-events-none absolute -left-9 top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover/queued:pointer-events-auto group-hover/queued:opacity-100">
                        <Tooltip content="Remove from queue" side="left">
                            <button
                                type="button"
                                onClick={() => remove(conversationId, queued.id)}
                                aria-label="Remove queued prompt"
                                className="flex size-6 items-center justify-center rounded-md border border-dark-700 bg-dark-900 text-dark-300 transition-colors hover:bg-dark-800 hover:text-red-500"
                            >
                                <XIcon className="size-3" weight="bold" />
                            </button>
                        </Tooltip>
                    </div>
                </div>
            </div>
        </div>
    );
}
