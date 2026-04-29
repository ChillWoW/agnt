import { useCallback, useState } from "react";
import {
    CheckIcon,
    CopyIcon,
    PencilSimpleIcon
} from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { Tooltip, toast } from "@/components/ui";
import type { Message } from "@/features/conversations/conversation-types";

interface UserMessageFooterProps {
    message: Message;
    /**
     * Renders the edit pencil. Only the latest user bubble passes
     * `canEdit`; older user messages are immutable.
     */
    canEdit?: boolean;
    onEditClick?: () => void;
}

/**
 * Footer rendered below user message bubbles. Mirrors the structure of
 * the assistant `MessageFooter` (small `text-[11px] text-dark-300` row
 * with hover-revealed icon buttons) but with user-specific contents:
 * the time the message was sent, a copy button, and — for the latest
 * user bubble only — an edit pencil that triggers inline edit mode in
 * `MessageBubble`.
 */
export function UserMessageFooter({
    message,
    canEdit = false,
    onEditClick
}: UserMessageFooterProps) {
    const [copied, setCopied] = useState(false);

    const handleCopy = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(message.content);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
        } catch (error) {
            toast.error({
                title: "Couldn't copy message",
                description:
                    error instanceof Error
                        ? error.message
                        : "Clipboard unavailable."
            });
        }
    }, [message.content]);

    const sentAt = parseTimestamp(message.created_at);
    if (!sentAt) return null;

    const clock = formatClockTime(sentAt);
    const absolute = formatAbsoluteTime(sentAt);

    return (
        <div
            className={cn(
                "mt-0.5 flex min-h-[1.25rem] items-center justify-end gap-2 text-[11px] text-dark-300 transition-opacity",
                "opacity-0 focus-within:opacity-100 group-hover/message:opacity-100",
                copied && "opacity-100"
            )}
        >
            <Tooltip content={absolute} side="top">
                <span className="cursor-default tabular-nums">{clock}</span>
            </Tooltip>
            {message.content.length > 0 && (
                <Tooltip
                    content={copied ? "Copied" : "Copy message"}
                    side="top"
                >
                    <button
                        type="button"
                        onClick={handleCopy}
                        aria-label="Copy message"
                        className="flex size-5.5 items-center justify-center rounded text-dark-300 hover:bg-dark-800 hover:text-dark-50"
                    >
                        {copied ? (
                            <CheckIcon className="size-3" weight="bold" />
                        ) : (
                            <CopyIcon className="size-3" weight="bold" />
                        )}
                    </button>
                </Tooltip>
            )}
            {canEdit && onEditClick && (
                <Tooltip content="Edit message" side="top">
                    <button
                        type="button"
                        onClick={onEditClick}
                        aria-label="Edit message"
                        className="flex size-5.5 items-center justify-center rounded text-dark-300 hover:bg-dark-800 hover:text-dark-50"
                    >
                        <PencilSimpleIcon
                            className="size-3"
                            weight="bold"
                        />
                    </button>
                </Tooltip>
            )}
        </div>
    );
}

function parseTimestamp(iso: string): Date | null {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return null;
    return date;
}

/**
 * Wall-clock label like `5:58 PM` (or 24-hour `17:58` depending on the
 * user's locale). The footer always shows the time the message was sent,
 * regardless of how old it is — the date is reachable via the tooltip.
 */
function formatClockTime(date: Date): string {
    return date.toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit"
    });
}

function formatAbsoluteTime(date: Date): string {
    return date.toLocaleString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
    });
}
