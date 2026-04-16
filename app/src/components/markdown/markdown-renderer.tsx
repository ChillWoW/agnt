import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import type { Components } from "react-markdown";
import { useMemo } from "react";
import { CodeBlock } from "./code-block";
import { ImageViewer } from "./image-viewer";
import { normalizeSafeImageUrl, normalizeSafeLinkUrl } from "@/lib/safe-url";

interface MarkdownRendererProps {
    content: string;
    isStreaming?: boolean;
}

function normalizeStreamingMarkdown(content: string, isStreaming?: boolean) {
    if (!isStreaming || content.length === 0) {
        return content;
    }

    const fenceMatches = content.match(/```/g);
    const fenceCount = fenceMatches?.length ?? 0;

    if (fenceCount % 2 === 0) {
        return content;
    }

    return `${content}\n\n\`\`\``;
}

function createComponents(): Components {
    return {
        code({ className, children, ...props }) {
            const match = /language-([\w-]+)/.exec(className || "");
            const language = match?.[1]?.toLowerCase();
            const isBlock = language != null;
            const code = String(children).replace(/\n$/, "");

            if (isBlock)
                return <CodeBlock language={language}>{code}</CodeBlock>;

            return (
                <code
                    className="rounded bg-dark-800 px-1 py-0.5 text-[13px] font-mono text-dark-50"
                    {...props}
                >
                    {children}
                </code>
            );
        },
        pre({ children }) {
            return <>{children}</>;
        },
        p({ children }) {
            return (
                <p className="mb-3 text-sm leading-7 text-dark-100 last:mb-0">
                    {children}
                </p>
            );
        },
        h1({ children }) {
            return (
                <h1 className="mb-2 mt-4 text-xl font-bold text-dark-50">
                    {children}
                </h1>
            );
        },
        h2({ children }) {
            return (
                <h2 className="mb-2 mt-3 text-lg font-semibold text-dark-50">
                    {children}
                </h2>
            );
        },
        h3({ children }) {
            return (
                <h3 className="mb-1 mt-2 text-base font-semibold text-dark-50">
                    {children}
                </h3>
            );
        },
        h4({ children }) {
            return (
                <h4 className="mb-1 mt-2 text-sm font-semibold text-dark-50">
                    {children}
                </h4>
            );
        },
        ul({ children }) {
            return (
                <ul className="mb-3 list-disc space-y-1 pl-5 text-dark-50">
                    {children}
                </ul>
            );
        },
        ol({ children }) {
            return (
                <ol className="mb-3 list-decimal space-y-1 pl-5 text-dark-50">
                    {children}
                </ol>
            );
        },
        li({ children }) {
            return <li className="text-sm leading-7">{children}</li>;
        },
        blockquote({ children }) {
            return (
                <blockquote className="my-3 border-l-2 border-primary-400 pl-3 italic text-dark-200">
                    {children}
                </blockquote>
            );
        },
        a({ href, children }) {
            const safeHref = normalizeSafeLinkUrl(href);

            if (!safeHref) {
                return <span className="text-dark-100">{children}</span>;
            }

            return (
                <a
                    href={safeHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    referrerPolicy="no-referrer"
                    className="text-primary-300 underline hover:text-primary-400"
                >
                    {children}
                </a>
            );
        },
        img({ src, alt }) {
            const safeImage = normalizeSafeImageUrl(src);

            if (!safeImage) {
                return (
                    <span className="text-sm text-dark-300">
                        Image blocked because the URL is not allowed.
                    </span>
                );
            }

            if (!safeImage.autoLoad) {
                return (
                    <a
                        href={safeImage.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        referrerPolicy="no-referrer"
                        className="inline-flex rounded-md border border-dark-600 px-3 py-2 text-sm text-dark-100 transition-colors hover:border-dark-500 hover:text-dark-50"
                    >
                        Open external image
                    </a>
                );
            }

            return <ImageViewer src={safeImage.url} alt={alt || ""} />;
        },
        table({ children }) {
            return (
                <div className="my-3 overflow-x-auto">
                    <table className="w-full border-collapse text-sm text-dark-50">
                        {children}
                    </table>
                </div>
            );
        },
        th({ children }) {
            return (
                <th className="border border-dark-600 bg-dark-850 px-3 py-1.5 text-left font-semibold">
                    {children}
                </th>
            );
        },
        td({ children }) {
            return (
                <td className="border border-dark-600 text-dark-100 px-3 py-1.5">
                    {children}
                </td>
            );
        },
        strong({ children }) {
            return (
                <strong className="font-semibold text-dark-100">
                    {children}
                </strong>
            );
        },
        em({ children }) {
            return <em className="italic text-dark-100">{children}</em>;
        },
        hr() {
            return <hr className="my-4 border-dark-600" />;
        }
    };
}

export function MarkdownRenderer({
    content,
    isStreaming
}: MarkdownRendererProps) {
    const displayContent = normalizeStreamingMarkdown(content, isStreaming);
    const components = useMemo(() => createComponents(), []);

    return (
        <div className="min-w-0">
            <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkMath]}
                rehypePlugins={[rehypeKatex]}
                components={components}
            >
                {displayContent}
            </ReactMarkdown>
        </div>
    );
}
