import { useState, useCallback } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { CopyIcon, CheckIcon } from "@phosphor-icons/react";

interface CodeBlockProps {
    language: string;
    children: string;
}

export function CodeBlock({ language, children }: CodeBlockProps) {
    const [copied, setCopied] = useState(false);

    const handleCopy = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(children);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {}
    }, [children]);

    return (
        <div className="my-3 overflow-hidden rounded-md border border-dark-700 bg-dark-900">
            <div className="flex items-center justify-between border-b border-dark-700 bg-dark-850 px-2.5 h-8">
                {language && (
                    <span className="text-[11px] font-medium text-dark-300">
                        {language.charAt(0).toUpperCase() + language.slice(1)}
                    </span>
                )}
                <button
                    type="button"
                    onClick={handleCopy}
                    className="ml-auto flex items-center gap-1.5 rounded px-1.5 h-6 text-[11px] text-dark-300 transition-colors hover:bg-dark-800 hover:text-dark-50"
                >
                    {copied ? (
                        <CheckIcon className="size-3" weight="bold" />
                    ) : (
                        <CopyIcon className="size-3" weight="bold" />
                    )}
                    <span>{copied ? "Copied" : "Copy"}</span>
                </button>
            </div>
            <SyntaxHighlighter
                language={language || "text"}
                style={vscDarkPlus}
                customStyle={{
                    margin: 0,
                    padding: "8px 12px",
                    background: "transparent",
                    fontSize: "13px",
                    lineHeight: "1.6"
                }}
                codeTagProps={{
                    style: { fontFamily: '"IBM Plex Mono", monospace' }
                }}
            >
                {children}
            </SyntaxHighlighter>
        </div>
    );
}
