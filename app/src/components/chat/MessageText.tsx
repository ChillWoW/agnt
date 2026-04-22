import { Fragment, type ReactNode } from "react";
import { cn } from "@/lib/cn";

const MENTION_REGEX = /(?:^|(?<=[\s(\[{]))@([A-Za-z0-9_./\\\-]+\/?)/g;

interface MessageTextProps {
    content: string;
    className?: string;
}

/**
 * Renders plain user message text and turns `@path` / `@path/` tokens into
 * styled chips. Intentionally minimal (no markdown) because user messages
 * rarely contain formatting and mention chips should stand out.
 */
export function MessageText({ content, className }: MessageTextProps) {
    if (content.length === 0) return null;

    return (
        <div className={cn("whitespace-pre-wrap text-sm", className)}>
            {renderWithMentions(content)}
        </div>
    );
}

function renderWithMentions(content: string): ReactNode[] {
    const nodes: ReactNode[] = [];
    const regex = new RegExp(MENTION_REGEX.source, "g");
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    let key = 0;

    while ((match = regex.exec(content)) !== null) {
        const raw = match[1];
        if (!raw) continue;

        const tokenStart = match.index + match[0].length - raw.length - 1;
        const tokenEnd = match.index + match[0].length;

        if (tokenStart > lastIndex) {
            nodes.push(
                <Fragment key={`t-${key++}`}>
                    {content.slice(lastIndex, tokenStart)}
                </Fragment>
            );
        }

        const isDir = raw.endsWith("/");
        const path = isDir ? raw.slice(0, -1) : raw;
        const display = isDir ? `${path}/` : path;

        nodes.push(
            <span
                key={`m-${key++}`}
                className="message-mention-chip"
                data-type={isDir ? "directory" : "file"}
                data-path={path}
                title={path}
            >
                @{display}
            </span>
        );

        lastIndex = tokenEnd;
    }

    if (lastIndex < content.length) {
        nodes.push(
            <Fragment key={`t-${key++}`}>{content.slice(lastIndex)}</Fragment>
        );
    }

    return nodes;
}
