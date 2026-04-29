import { useEffect, useMemo, useRef } from "react";
import Anser from "anser";
import type { ShellStreamChunk } from "@/features/conversations/conversation-types";

/**
 * Render a string containing ANSI escape sequences (colors, styles, cursor
 * moves) as styled React nodes. Uses `anser` for parsing — we don't want to
 * hand-roll this because ANSI has a long tail of edge cases (256-colour,
 * truecolor, SGR combinations, OSC/DEC sequences, etc).
 */
function ansiToNodes(text: string, keyPrefix: string): React.ReactNode[] {
    if (!text) return [];
    const parts = Anser.ansiToJson(text, {
        use_classes: false,
        json: true,
        remove_empty: true
    });

    return parts.map((part, idx) => {
        const style: React.CSSProperties = {};
        if (part.fg) style.color = `rgb(${part.fg})`;
        if (part.bg) style.backgroundColor = `rgb(${part.bg})`;

        const decos = Array.isArray(part.decorations)
            ? part.decorations
            : typeof part.decoration === "string"
              ? [part.decoration]
              : [];
        const decorations: string[] = [];
        if (decos.includes("bold")) style.fontWeight = 600;
        if (decos.includes("dim")) style.opacity = 0.7;
        if (decos.includes("italic")) style.fontStyle = "italic";
        if (decos.includes("underline")) decorations.push("underline");
        if (decos.includes("strikethrough")) decorations.push("line-through");
        if (decorations.length > 0) {
            style.textDecoration = decorations.join(" ");
        }
        if (decos.includes("reverse")) {
            const fg = style.color;
            style.color = style.backgroundColor ?? "inherit";
            style.backgroundColor = fg ?? "inherit";
        }
        if (decos.includes("hidden")) style.visibility = "hidden";

        return (
            <span key={`${keyPrefix}-${idx}`} style={style}>
                {part.content}
            </span>
        );
    });
}

interface TerminalPaneProps {
    chunks: readonly ShellStreamChunk[];
    isStreaming: boolean;
    truncated?: boolean;
    emptyLabel?: string;
    command?: string;
    workingDirectory?: string;
}

export function TerminalPane({
    chunks,
    isStreaming,
    truncated,
    emptyLabel,
    command,
    workingDirectory
}: TerminalPaneProps) {
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const pinnedToBottomRef = useRef(true);

    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        const handleScroll = () => {
            const distanceFromBottom =
                el.scrollHeight - el.scrollTop - el.clientHeight;
            pinnedToBottomRef.current = distanceFromBottom < 24;
        };
        el.addEventListener("scroll", handleScroll, { passive: true });
        return () => el.removeEventListener("scroll", handleScroll);
    }, []);

    useEffect(() => {
        if (!pinnedToBottomRef.current) return;
        const el = scrollRef.current;
        if (!el) return;
        el.scrollTop = el.scrollHeight;
    }, [chunks, isStreaming]);

    const rendered = useMemo(() => {
        return chunks.map((part, idx) => {
            const isStderr = part.stream === "stderr";
            const nodes = ansiToNodes(part.chunk, `c${idx}`);
            if (!isStderr) {
                return <span key={idx}>{nodes}</span>;
            }
            return (
                <span key={idx} className="text-red-300">
                    {nodes}
                </span>
            );
        });
    }, [chunks]);

    const hasOutput = chunks.length > 0;
    const hasCommand = typeof command === "string" && command.length > 0;
    const showEmpty = !hasOutput && !isStreaming && !hasCommand;

    if (showEmpty) {
        return (
            <div className="rounded-md border border-dark-700 bg-dark-900 px-2.5 py-1.5 font-mono text-[11px] text-dark-200">
                {emptyLabel ?? "(no output)"}
            </div>
        );
    }

    return (
        <div className="overflow-hidden rounded-md border border-dark-700 bg-dark-900 font-mono text-[11px] leading-[1.5] text-dark-100">
            {(hasCommand || workingDirectory) && (
                <div className="flex flex-col gap-0.5 border-b border-dark-700 px-2.5 pt-1.5 pb-1.5">
                    {hasCommand && (
                        <div className="flex min-w-0 items-baseline gap-1.5">
                            <span
                                aria-hidden
                                className="shrink-0 select-none text-dark-300"
                            >
                                $
                            </span>
                            <span className="min-w-0 break-all text-dark-50">
                                {command}
                            </span>
                        </div>
                    )}
                    {workingDirectory && (
                        <div className="flex min-w-0 font-sans text-[11px] text-dark-300">
                            <span className="min-w-0 truncate">
                                {workingDirectory}
                            </span>
                        </div>
                    )}
                </div>
            )}
            {truncated && (
                <div className="border-b border-dark-700 px-2.5 py-1 text-[11px] text-amber-200/80">
                    in-memory buffer truncated — see log_path for full output
                </div>
            )}
            <div
                ref={scrollRef}
                className="max-h-56 overflow-y-auto px-2.5 py-1.5"
            >
                {!hasOutput && !isStreaming ? (
                    <span className="text-dark-200">
                        {emptyLabel ?? "(no output)"}
                    </span>
                ) : (
                    <pre className="whitespace-pre-wrap break-words">
                        {rendered}
                        {isStreaming && (
                            <span
                                aria-hidden
                                className="ml-0.5 inline-block w-[7px] animate-pulse bg-dark-200 align-baseline"
                            >
                                &#x2007;
                            </span>
                        )}
                    </pre>
                )}
            </div>
        </div>
    );
}
