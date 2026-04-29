import {
    ArrowSquareOutIcon,
    GlobeHemisphereWestIcon
} from "@phosphor-icons/react";
import type {
    ToolInvocation,
    ToolInvocationStatus
} from "@/features/conversations/conversation-types";
import { ToolBlock } from "./shared/ToolBlock";
import { faviconUrl, hostnameOf, isRecord, truncate } from "./shared/format";

interface WebSearchInputShape {
    query?: string;
    maxResults?: number;
    categories?: string;
    language?: string;
    timeRange?: "day" | "month" | "year";
    safesearch?: 0 | 1 | 2;
}

interface WebSearchResultShape {
    title?: string;
    url?: string;
    content?: string;
    engine?: string | null;
    score?: number | null;
}

interface WebSearchOutputShape {
    ok?: boolean;
    query?: string;
    results?: WebSearchResultShape[];
    count?: number;
    truncated?: boolean;
    totalAvailable?: number;
    error?: string;
}

function formatWebSearchDetail(
    input: WebSearchInputShape | undefined,
    output: WebSearchOutputShape | undefined
): string | undefined {
    const query =
        (typeof output?.query === "string" && output.query.length > 0
            ? output.query
            : undefined) ??
        (typeof input?.query === "string" && input.query.length > 0
            ? input.query
            : undefined);
    const count =
        typeof output?.count === "number"
            ? output.count
            : Array.isArray(output?.results)
              ? output.results.length
              : undefined;

    if (!query) return undefined;
    const trimmedQuery = truncate(query.trim(), 48);
    if (typeof count === "number") {
        const suffix = output?.truncated ? "+" : "";
        return `${trimmedQuery} · ${count}${suffix} result${count === 1 ? "" : "s"}`;
    }
    return trimmedQuery;
}

export function WebSearchBlock({
    invocation
}: {
    invocation: ToolInvocation;
}) {
    const input = isRecord(invocation.input)
        ? (invocation.input as WebSearchInputShape)
        : undefined;
    const output = isRecord(invocation.output)
        ? (invocation.output as WebSearchOutputShape)
        : undefined;

    const toolFailed = output?.ok === false;
    const status: ToolInvocationStatus = toolFailed
        ? "error"
        : invocation.status;
    const error =
        invocation.error ??
        (toolFailed ? (output?.error ?? "Web search failed") : null);

    const results = Array.isArray(output?.results) ? output.results : [];

    return (
        <ToolBlock
            icon={
                <GlobeHemisphereWestIcon className="size-3.5" weight="bold" />
            }
            pendingLabel="Searching the web"
            successLabel="Searched the web"
            errorLabel="Web search failed"
            deniedLabel="Web search denied"
            detail={formatWebSearchDetail(input, output)}
            error={error}
            status={status}
        >
            {error ? (
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-red-200">
                    {error}
                </p>
            ) : results.length > 0 ? (
                <ul className="flex flex-col gap-1.5 py-1">
                    {results.map((r, idx) => {
                        const url = typeof r.url === "string" ? r.url : "";
                        if (url.length === 0) return null;
                        const title =
                            typeof r.title === "string" && r.title.length > 0
                                ? r.title
                                : url;
                        const snippet =
                            typeof r.content === "string"
                                ? r.content.replace(/\s+/g, " ").trim()
                                : "";
                        const host = hostnameOf(url);
                        const favicon = faviconUrl(url);
                        const engine =
                            typeof r.engine === "string" && r.engine.length > 0
                                ? r.engine
                                : null;
                        return (
                            <li
                                key={`${url}-${idx}`}
                                className="group rounded-md border border-dark-700 bg-dark-900 px-2.5 py-1.5 transition-colors hover:border-dark-600 hover:bg-dark-850"
                            >
                                <a
                                    href={url}
                                    target="_blank"
                                    rel="noreferrer noopener"
                                    className="flex min-w-0 flex-col gap-0.5"
                                >
                                    <div className="flex min-w-0 items-center gap-1.5">
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
                                                        ).style.visibility =
                                                            "hidden";
                                                    }}
                                                />
                                            ) : (
                                                <GlobeHemisphereWestIcon className="size-3 text-dark-300" />
                                            )}
                                        </span>
                                        <span className="min-w-0 truncate text-[11px] font-medium text-dark-100 group-hover:text-dark-50">
                                            {title}
                                        </span>
                                        <ArrowSquareOutIcon className="size-3 shrink-0 text-dark-200 opacity-0 transition-opacity group-hover:opacity-100" />
                                    </div>
                                    <div className="flex min-w-0 items-center gap-1 pl-[22px] text-[10px] text-dark-300">
                                        <span className="truncate">{host}</span>
                                        {engine && (
                                            <>
                                                <span className="text-dark-300">
                                                    ·
                                                </span>
                                                <span className="shrink-0 truncate">
                                                    {engine}
                                                </span>
                                            </>
                                        )}
                                    </div>
                                    {snippet.length > 0 && (
                                        <p className="pl-[22px] text-[11px] leading-snug text-dark-200 line-clamp-2">
                                            {snippet}
                                        </p>
                                    )}
                                </a>
                            </li>
                        );
                    })}
                    {output?.truncated &&
                        typeof output.totalAvailable === "number" && (
                            <li className="pl-[22px] text-[10px] text-dark-300">
                                … {output.totalAvailable - results.length} more
                                results truncated
                            </li>
                        )}
                </ul>
            ) : output?.ok === true ? (
                <p className="py-1 text-[11px] text-dark-300 italic">
                    No results returned.
                </p>
            ) : null}
        </ToolBlock>
    );
}
