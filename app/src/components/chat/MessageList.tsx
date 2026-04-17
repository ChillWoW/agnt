import { useCallback, useEffect, useMemo, useRef } from "react";
import { ArrowDownIcon, ArchiveIcon } from "@phosphor-icons/react";
import type { Message } from "@/features/conversations/conversation-types";
import { MessageBubble } from "./MessageBubble";

const SCROLL_THRESHOLD = 80;

interface MessageListProps {
    messages: Message[];
}

export function MessageList({ messages }: MessageListProps) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const isAtBottom = useRef(true);
    const showScrollButton = useRef(false);
    const buttonRef = useRef<HTMLDivElement>(null);
    const scrollThrottleTimer = useRef<ReturnType<typeof setTimeout> | null>(
        null
    );

    const setButtonVisible = useCallback((visible: boolean) => {
        if (showScrollButton.current === visible) return;
        showScrollButton.current = visible;
        if (buttonRef.current) {
            buttonRef.current.style.opacity = visible ? "1" : "0";
            buttonRef.current.style.transform = visible
                ? "translateX(-50%) translateY(0)"
                : "translateX(-50%) translateY(8px)";
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
    }, [messages, snapToBottom]);

    const renderedItems = useMemo(() => {
        const items: Array<
            | { kind: "message"; message: Message }
            | { kind: "banner"; id: string; count: number }
        > = [];

        let pendingCompactedCount = 0;

        for (const message of messages) {
            if (message.compacted) {
                pendingCompactedCount += 1;
                continue;
            }

            if (
                message.role === "system" &&
                message.summary_of_until &&
                pendingCompactedCount > 0
            ) {
                items.push({
                    kind: "banner",
                    id: `banner-${message.id}`,
                    count: pendingCompactedCount
                });
                pendingCompactedCount = 0;
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
                        if (item.kind === "banner") {
                            return (
                                <CompactionBanner
                                    key={item.id}
                                    count={item.count}
                                />
                            );
                        }
                        const message = item.message;
                        if (
                            message.role === "system" &&
                            message.summary_of_until
                        ) {
                            return (
                                <CompactionSummary
                                    key={message.id}
                                    message={message}
                                />
                            );
                        }
                        return (
                            <MessageBubble
                                key={message.id}
                                message={message}
                            />
                        );
                    })}
                </div>
            </div>

            <div
                ref={buttonRef}
                style={{
                    position: "absolute",
                    bottom: "1rem",
                    left: "50%",
                    transform: "translateX(-50%) translateY(8px)",
                    opacity: 0,
                    pointerEvents: "none",
                    transition: "opacity 150ms ease, transform 150ms ease"
                }}
            >
                <button
                    type="button"
                    onClick={smoothScrollToBottom}
                    className="flex items-center gap-1.5 rounded-full border border-dark-700 bg-dark-850 px-3 py-1.5 text-xs text-dark-100 shadow-sm transition-colors hover:bg-dark-700 hover:text-dark-50"
                >
                    <ArrowDownIcon className="size-3.5" weight="bold" />
                    Back to bottom
                </button>
            </div>
        </div>
    );
}

function CompactionBanner({ count }: { count: number }) {
    return (
        <div className="my-4 flex items-center gap-2 text-[11px] uppercase tracking-wide text-dark-300">
            <div className="h-px flex-1 bg-dark-700" />
            <ArchiveIcon className="size-3.5" weight="bold" />
            <span>
                Compacted {count} older {count === 1 ? "message" : "messages"}{" "}
                into a summary
            </span>
            <div className="h-px flex-1 bg-dark-700" />
        </div>
    );
}

function CompactionSummary({ message }: { message: Message }) {
    return (
        <details className="mb-4 rounded-md border border-dark-700 bg-dark-900 text-xs text-dark-100">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-dark-200 transition-colors hover:text-dark-50">
                <ArchiveIcon className="size-3.5" weight="bold" />
                <span>Conversation summary</span>
                <span className="ml-auto text-[11px] text-dark-300">
                    click to expand
                </span>
            </summary>
            <div className="whitespace-pre-wrap border-t border-dark-800 px-3 py-2 text-dark-100">
                {message.content}
            </div>
        </details>
    );
}
