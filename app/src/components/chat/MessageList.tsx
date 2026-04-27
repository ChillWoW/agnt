import { useCallback, useEffect, useMemo, useRef } from "react";
import { ArchiveIcon, CaretRightIcon } from "@phosphor-icons/react";
import type { Message } from "@/features/conversations/conversation-types";
import { MarkdownRenderer } from "@/components/markdown/markdown-renderer";
import {
    useConversationStore,
    usePromptQueueStore
} from "@/features/conversations";
import type { QueuedPrompt } from "@/features/conversations";
import { MessageBubble } from "./MessageBubble";
import { QueuedPromptBubble } from "./QueuedPromptBubble";

const SCROLL_THRESHOLD = 80;

// Stable empty fallback so the prompt-queue selector returns the same
// reference across renders when a conversation has nothing queued. Returning
// a fresh `[]` on every call breaks `useSyncExternalStore`'s snapshot
// equality and triggers React's "Maximum update depth exceeded" guard.
const EMPTY_QUEUE: QueuedPrompt[] = [];

interface MessageListProps {
    messages: Message[];
    conversationId?: string;
    scrollButtonRef?: React.RefObject<HTMLDivElement | null>;
    scrollToBottomRef?: React.RefObject<(() => void) | null>;
}

export function MessageList({
    messages,
    conversationId,
    scrollButtonRef,
    scrollToBottomRef
}: MessageListProps) {
    const isCompacting = useConversationStore((state) =>
        conversationId
            ? Boolean(state.compactingByConversationId[conversationId])
            : false
    );
    const queuedPrompts = usePromptQueueStore((state) =>
        conversationId
            ? (state.queueByConversationId[conversationId] ?? EMPTY_QUEUE)
            : EMPTY_QUEUE
    );
    const scrollRef = useRef<HTMLDivElement>(null);
    const isAtBottom = useRef(true);
    const showScrollButton = useRef(false);
    const buttonRef = scrollButtonRef ?? { current: null };
    const scrollThrottleTimer = useRef<ReturnType<typeof setTimeout> | null>(
        null
    );

    const setButtonVisible = useCallback((visible: boolean) => {
        if (showScrollButton.current === visible) return;
        showScrollButton.current = visible;
        if (buttonRef.current) {
            buttonRef.current.style.opacity = visible ? "1" : "0";
            buttonRef.current.style.transform = visible
                ? "translateY(0)"
                : "translateY(4px)";
            buttonRef.current.style.pointerEvents = visible ? "auto" : "none";
        }
    }, []);

    const snapToBottom = useCallback(() => {
        const container = scrollRef.current;
        if (!container) return;
        container.scrollTop = container.scrollHeight;
        isAtBottom.current = true;
        setButtonVisible(false);
    }, [setButtonVisible]);

    const smoothScrollToBottom = useCallback(() => {
        const container = scrollRef.current;
        if (!container) return;
        isAtBottom.current = true;
        setButtonVisible(false);
        container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    }, [setButtonVisible]);

    useEffect(() => {
        if (scrollToBottomRef) scrollToBottomRef.current = smoothScrollToBottom;
    }, [scrollToBottomRef, smoothScrollToBottom]);

    useEffect(() => {
        const container = scrollRef.current;
        if (!container) return;

        const handleScroll = () => {
            const { scrollTop, scrollHeight, clientHeight } = container;
            isAtBottom.current =
                scrollHeight - scrollTop - clientHeight < SCROLL_THRESHOLD;

            if (scrollThrottleTimer.current) return;
            scrollThrottleTimer.current = setTimeout(() => {
                scrollThrottleTimer.current = null;
                const {
                    scrollTop: st,
                    scrollHeight: sh,
                    clientHeight: ch
                } = container;
                setButtonVisible(sh - st - ch >= SCROLL_THRESHOLD);
            }, 100);
        };

        container.addEventListener("scroll", handleScroll, { passive: true });
        return () => {
            container.removeEventListener("scroll", handleScroll);
            if (scrollThrottleTimer.current)
                clearTimeout(scrollThrottleTimer.current);
        };
    }, [setButtonVisible]);

    useEffect(() => {
        if (isAtBottom.current) {
            snapToBottom();
        }
    }, [messages, isCompacting, queuedPrompts.length, snapToBottom]);

    const renderedItems = useMemo(() => {
        const items: Array<
            | { kind: "message"; message: Message }
            | {
                  kind: "compaction";
                  id: string;
                  count: number;
                  message: Message;
              }
        > = [];

        let pendingCompactedCount = 0;

        for (const message of messages) {
            if (message.compacted) {
                pendingCompactedCount += 1;
                continue;
            }

            if (message.role === "system" && message.summary_of_until) {
                items.push({
                    kind: "compaction",
                    id: `compaction-${message.id}`,
                    count: pendingCompactedCount,
                    message
                });
                pendingCompactedCount = 0;
                continue;
            }

            items.push({ kind: "message", message });
        }

        return items;
    }, [messages]);

    return (
        <div className="relative h-full overflow-hidden">
            <div ref={scrollRef} className="h-full overflow-y-auto">
                <div className="mx-auto max-w-3xl px-4 py-6">
                    {renderedItems.map((item) => {
                        if (item.kind === "compaction") {
                            return (
                                <CompactionMarker
                                    key={item.id}
                                    count={item.count}
                                    message={item.message}
                                />
                            );
                        }
                        return (
                            <MessageBubble
                                key={item.message.id}
                                message={item.message}
                            />
                        );
                    })}
                    {isCompacting && <CompactionInProgress />}
                    {conversationId &&
                        queuedPrompts.map((queued) => (
                            <QueuedPromptBubble
                                key={queued.id}
                                queued={queued}
                                conversationId={conversationId}
                            />
                        ))}
                </div>
            </div>
        </div>
    );
}

function CompactionInProgress() {
    return (
        <div className="my-6 flex items-center gap-2 text-[11px] uppercase tracking-wide text-dark-300">
            <div className="h-px flex-1 bg-dark-700" />
            <div className="flex items-center gap-1.5">
                <ArchiveIcon
                    className="size-3.5 animate-pulse"
                    weight="bold"
                />
                <span>Summarizing chat context…</span>
            </div>
            <div className="h-px flex-1 bg-dark-700" />
        </div>
    );
}

const COMPACTION_PRELUDE_RE = /^\[Compacted summary of \d+ earlier messages\]\s*\n+/;

function stripCompactionPrelude(content: string): string {
    return content.replace(COMPACTION_PRELUDE_RE, "");
}

function CompactionMarker({
    count,
    message
}: {
    count: number;
    message: Message;
}) {
    const summaryBody = useMemo(
        () => stripCompactionPrelude(message.content).trim(),
        [message.content]
    );
    const hasBody = summaryBody.length > 0;

    return (
        <details className="group/compact my-6">
            <summary
                className={
                    "flex list-none items-center gap-2 text-[11px] uppercase tracking-wide text-dark-300 transition-colors " +
                    (hasBody
                        ? "cursor-pointer hover:text-dark-100"
                        : "cursor-default")
                }
            >
                <div className="h-px flex-1 bg-dark-700" />
                <div className="flex items-center gap-1.5">
                    {hasBody && (
                        <CaretRightIcon
                            className="size-3 transition-transform group-open/compact:rotate-90"
                            weight="bold"
                        />
                    )}
                    <ArchiveIcon className="size-3.5" weight="bold" />
                    <span>Chat context summarized</span>
                    {count > 0 && (
                        <span className="font-normal normal-case tracking-normal text-dark-400">
                            · {count} older {count === 1 ? "message" : "messages"}
                        </span>
                    )}
                </div>
                <div className="h-px flex-1 bg-dark-700" />
            </summary>
            {hasBody && (
                <div className="mt-3 rounded-md border border-dark-700 bg-dark-900 px-3 py-2 text-xs text-dark-100">
                    <MarkdownRenderer content={summaryBody} />
                </div>
            )}
        </details>
    );
}
