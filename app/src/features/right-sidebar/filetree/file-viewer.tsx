import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { MarkdownRenderer } from "@/components/markdown/markdown-renderer";
import { useOpenedFilesStore } from "./opened-files-store";
import {
    formatBytes,
    getPrismLanguage,
    isMarkdownFile
} from "./file-language";

interface FileViewerProps {
    path: string;
}

export function FileViewer({ path }: FileViewerProps) {
    const file = useOpenedFilesStore((s) => s.files[path]);
    const refreshFile = useOpenedFilesStore((s) => s.refreshFile);

    if (!file) return null;

    if (file.loading && file.content === null) {
        return (
            <div className="flex flex-1 items-center justify-center text-xs text-dark-300 select-none">
                Loading…
            </div>
        );
    }

    if (file.error) {
        return (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center text-xs text-red-400/80 select-none">
                <span>{file.error}</span>
                <button
                    type="button"
                    onClick={() => {
                        void refreshFile(path);
                    }}
                    className="rounded px-2 py-1 text-dark-200 transition-colors hover:bg-dark-800 hover:text-dark-50"
                >
                    Retry
                </button>
            </div>
        );
    }

    if (file.binary) {
        return (
            <div className="flex flex-1 flex-col items-center justify-center gap-1 px-4 text-center text-xs text-dark-300 select-none">
                <span>Binary file</span>
                <span className="text-dark-400">{formatBytes(file.size)}</span>
            </div>
        );
    }

    const content = file.content ?? "";
    const renderAsMarkdown = isMarkdownFile(file.name);

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            {file.truncated && (
                <div className="shrink-0 border-b border-dark-700 bg-dark-850 px-3 py-1 text-[11px] text-dark-300">
                    File truncated — showing first {formatBytes(file.size)} is
                    too large.
                </div>
            )}
            {renderAsMarkdown ? (
                <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-2">
                    <MarkdownRenderer content={content} />
                </div>
            ) : (
                <div className="min-h-0 flex-1 overflow-auto">
                    <SyntaxHighlighter
                        language={getPrismLanguage(file.name)}
                        style={vscDarkPlus}
                        customStyle={{
                            margin: 0,
                            padding: "10px 12px",
                            background: "transparent",
                            fontSize: "12px",
                            lineHeight: "1.55",
                            overflow: "visible",
                            width: "max-content",
                            minWidth: "100%",
                            minHeight: "100%"
                        }}
                        codeTagProps={{
                            style: {
                                fontFamily: '"IBM Plex Mono", monospace',
                                whiteSpace: "pre"
                            }
                        }}
                    >
                        {content}
                    </SyntaxHighlighter>
                </div>
            )}
        </div>
    );
}
