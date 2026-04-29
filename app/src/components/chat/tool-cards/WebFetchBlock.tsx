import {
    ArrowSquareOutIcon,
    DownloadSimpleIcon,
    GlobeHemisphereWestIcon
} from "@phosphor-icons/react";
import type {
    ToolInvocation,
    ToolInvocationStatus
} from "@/features/conversations/conversation-types";
import { ToolBlock } from "./shared/ToolBlock";
import {
    faviconUrl,
    formatCharCount,
    hostnameOf,
    isRecord
} from "./shared/format";

interface WebFetchInputShape {
    url?: string;
    maxChars?: number;
}

interface WebFetchOutputShape {
    ok?: boolean;
    url?: string;
    finalUrl?: string;
    title?: string | null;
    description?: string | null;
    markdown?: string;
    charCount?: number;
    truncated?: boolean;
    statusCode?: number | null;
    error?: string;
}

function formatWebFetchDetail(
    input: WebFetchInputShape | undefined,
    output: WebFetchOutputShape | undefined
): string | undefined {
    const url =
        (typeof output?.finalUrl === "string" && output.finalUrl.length > 0
            ? output.finalUrl
            : undefined) ??
        (typeof output?.url === "string" && output.url.length > 0
            ? output.url
            : undefined) ??
        (typeof input?.url === "string" && input.url.length > 0
            ? input.url
            : undefined);

    if (!url) return undefined;
    const host = hostnameOf(url);
    if (typeof output?.charCount === "number" && output.charCount > 0) {
        return `${host} · ${formatCharCount(output.charCount)}`;
    }
    return host;
}

const WEB_FETCH_PREVIEW_CHARS = 1200;

export function WebFetchBlock({ invocation }: { invocation: ToolInvocation }) {
    const input = isRecord(invocation.input)
        ? (invocation.input as WebFetchInputShape)
        : undefined;
    const output = isRecord(invocation.output)
        ? (invocation.output as WebFetchOutputShape)
        : undefined;

    const toolFailed = output?.ok === false;
    const status: ToolInvocationStatus = toolFailed
        ? "error"
        : invocation.status;
    const error =
        invocation.error ??
        (toolFailed ? (output?.error ?? "Web fetch failed") : null);

    const detail = formatWebFetchDetail(input, output);

    const effectiveUrl =
        (typeof output?.finalUrl === "string" && output.finalUrl) ||
        (typeof output?.url === "string" && output.url) ||
        (typeof input?.url === "string" && input.url) ||
        "";
    const host = effectiveUrl ? hostnameOf(effectiveUrl) : "";
    const favicon = effectiveUrl ? faviconUrl(effectiveUrl) : null;
    const title =
        typeof output?.title === "string" && output.title.length > 0
            ? output.title
            : null;
    const description =
        typeof output?.description === "string" && output.description.length > 0
            ? output.description
            : null;
    const markdown =
        typeof output?.markdown === "string" ? output.markdown : "";
    const preview =
        markdown.length > WEB_FETCH_PREVIEW_CHARS
            ? markdown.slice(0, WEB_FETCH_PREVIEW_CHARS)
            : markdown;
    const previewHasMore = markdown.length > preview.length;
    const totalChars =
        typeof output?.charCount === "number"
            ? output.charCount
            : markdown.length;
    const remaining = Math.max(0, totalChars - preview.length);

    return (
        <ToolBlock
            icon={<DownloadSimpleIcon className="size-3.5" weight="bold" />}
            pendingLabel="Fetching page"
            successLabel="Fetched page"
            errorLabel="Web fetch failed"
            deniedLabel="Web fetch denied"
            detail={detail}
            error={error}
            status={status}
        >
            {error ? (
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-red-200">
                    {error}
                </p>
            ) : output?.ok === true ? (
                <div className="flex flex-col gap-1.5 py-1">
                    {effectiveUrl && (
                        <div className="flex min-w-0 items-center gap-1.5 rounded-md border border-dark-700 bg-dark-900 px-2.5 py-1.5">
                            <span className="inline-flex size-[14px] shrink-0 items-center justify-center overflow-hidden">
                                {favicon ? (
                                    <img
                                        src={favicon}
                                        alt=""
                                        width={14}
                                        height={14}
                                        loading="lazy"
                                        className="size-[14px] object-contain"
                                        onError={(e) => {
                                            (
                                                e.currentTarget as HTMLImageElement
                                            ).style.visibility = "hidden";
                                        }}
                                    />
                                ) : (
                                    <GlobeHemisphereWestIcon className="size-3 text-dark-300" />
                                )}
                            </span>
                            <div className="flex min-w-0 flex-1 flex-col">
                                {title && (
                                    <span className="truncate text-[11px] font-medium text-dark-100">
                                        {title}
                                    </span>
                                )}
                                <a
                                    href={effectiveUrl}
                                    target="_blank"
                                    rel="noreferrer noopener"
                                    className="flex min-w-0 items-center gap-1 text-[10px] text-dark-300 hover:text-dark-100"
                                >
                                    <span className="truncate">{host}</span>
                                    <ArrowSquareOutIcon className="size-3 shrink-0" />
                                </a>
                                {description && (
                                    <span className="truncate text-[10px] text-dark-300">
                                        {description}
                                    </span>
                                )}
                            </div>
                            {typeof output?.statusCode === "number" && (
                                <span className="shrink-0 rounded bg-dark-800 px-1.5 py-0.5 text-[10px] font-medium text-dark-200">
                                    {output.statusCode}
                                </span>
                            )}
                        </div>
                    )}
                    {preview.length > 0 ? (
                        <div className="max-h-48 overflow-y-auto rounded-md border border-dark-700 bg-dark-900 px-2.5 py-1.5">
                            <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-snug text-dark-200">
                                {preview}
                                {previewHasMore && "…"}
                            </pre>
                            {(previewHasMore || output?.truncated) && (
                                <p className="mt-1 text-[10px] italic text-dark-400">
                                    {previewHasMore
                                        ? `… ${remaining} more chars in preview`
                                        : ""}
                                    {output?.truncated &&
                                        " (response also truncated at maxChars)"}
                                </p>
                            )}
                        </div>
                    ) : (
                        <p className="px-1 text-[11px] italic text-dark-400">
                            Empty page — no markdown was extracted.
                        </p>
                    )}
                </div>
            ) : null}
        </ToolBlock>
    );
}
