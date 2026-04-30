import {
    ArrowSquareOutIcon,
    BrowsersIcon,
    CursorClickIcon,
    EyeIcon,
    GlobeIcon,
    KeyboardIcon,
    MagnifyingGlassIcon,
    SparkleIcon,
    StackIcon,
    TabsIcon,
    XCircleIcon
} from "@phosphor-icons/react";
import type {
    ToolInvocation,
    ToolInvocationStatus
} from "@/features/conversations/conversation-types";
import { ToolBlock } from "./shared/ToolBlock";
import {
    clampDetail,
    faviconUrl,
    formatCharCount,
    hostnameOf,
    isRecord,
    truncate
} from "./shared/format";

interface BrowserBlockProps {
    invocation: ToolInvocation;
}

interface BrowserOpMeta {
    tabId?: string;
    url?: string;
    title?: string;
}

interface BrowserOutputShape {
    ok?: boolean;
    error?: string;
    meta?: BrowserOpMeta;
    data?: Record<string, unknown>;
}

const TOOL_LABELS: Record<
    string,
    {
        pending: string;
        success: string;
        Icon: React.ElementType;
    }
> = {
    browser_list_tabs: {
        pending: "Listing browser tabs",
        success: "Listed browser tabs",
        Icon: TabsIcon
    },
    browser_open_tab: {
        pending: "Opening tab",
        success: "Opened tab",
        Icon: BrowsersIcon
    },
    browser_close_tab: {
        pending: "Closing tab",
        success: "Closed tab",
        Icon: XCircleIcon
    },
    browser_navigate: {
        pending: "Navigating",
        success: "Navigated",
        Icon: GlobeIcon
    },
    browser_back: {
        pending: "Going back",
        success: "Went back",
        Icon: GlobeIcon
    },
    browser_forward: {
        pending: "Going forward",
        success: "Went forward",
        Icon: GlobeIcon
    },
    browser_reload: {
        pending: "Reloading",
        success: "Reloaded",
        Icon: GlobeIcon
    },
    browser_read: {
        pending: "Reading page",
        success: "Read page",
        Icon: EyeIcon
    },
    browser_snapshot: {
        pending: "Snapshotting",
        success: "Snapshotted page",
        Icon: StackIcon
    },
    browser_find: {
        pending: "Searching page",
        success: "Searched page",
        Icon: MagnifyingGlassIcon
    },
    browser_click: {
        pending: "Clicking",
        success: "Clicked",
        Icon: CursorClickIcon
    },
    browser_type: {
        pending: "Typing",
        success: "Typed",
        Icon: KeyboardIcon
    },
    browser_press_key: {
        pending: "Pressing key",
        success: "Pressed key",
        Icon: KeyboardIcon
    },
    browser_scroll: {
        pending: "Scrolling",
        success: "Scrolled",
        Icon: GlobeIcon
    },
    browser_wait_for: {
        pending: "Waiting",
        success: "Waited",
        Icon: GlobeIcon
    },
    browser_get_state: {
        pending: "Reading state",
        success: "Read state",
        Icon: EyeIcon
    },
    browser_screenshot: {
        pending: "Screenshotting",
        success: "Took screenshot",
        Icon: SparkleIcon
    },
    browser_eval: {
        pending: "Evaluating JS",
        success: "Evaluated JS",
        Icon: SparkleIcon
    }
};

function getLabels(toolName: string) {
    return (
        TOOL_LABELS[toolName] ?? {
            pending: toolName,
            success: toolName,
            Icon: GlobeIcon
        }
    );
}

function formatDetail(
    toolName: string,
    input: Record<string, unknown> | undefined,
    output: BrowserOutputShape | undefined
): string | undefined {
    const meta = output?.meta;
    const url =
        (typeof meta?.url === "string" && meta.url.length > 0
            ? meta.url
            : undefined) ??
        (typeof input?.url === "string" && input.url.length > 0
            ? (input.url as string)
            : undefined);
    const title =
        typeof meta?.title === "string" && meta.title.length > 0
            ? meta.title
            : null;

    if (toolName === "browser_find" && typeof input?.query === "string") {
        return clampDetail(`"${input.query}"${url ? ` on ${hostnameOf(url)}` : ""}`);
    }
    if (
        toolName === "browser_click" ||
        toolName === "browser_type" ||
        toolName === "browser_scroll"
    ) {
        const ref =
            typeof input?.ref === "number"
                ? `ref=${input.ref}`
                : typeof input?.toRef === "number"
                  ? `ref=${input.toRef}`
                  : "";
        if (ref) {
            return clampDetail(
                `${ref}${url ? ` on ${hostnameOf(url)}` : ""}`
            );
        }
    }
    if (url) {
        const charCount =
            output?.data && typeof output.data.charCount === "number"
                ? (output.data.charCount as number)
                : null;
        if (charCount !== null && charCount > 0) {
            return clampDetail(
                `${title ?? hostnameOf(url)} · ${formatCharCount(charCount)}`
            );
        }
        return clampDetail(title ?? hostnameOf(url));
    }
    return undefined;
}

function renderBody(
    toolName: string,
    output: BrowserOutputShape | undefined
): React.ReactNode | null {
    if (!output || output.ok === false) return null;
    const data = output.data ?? {};

    if (toolName === "browser_read" && typeof data.markdown === "string") {
        return (
            <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-snug text-dark-200">
                {truncate(data.markdown, 1500)}
            </pre>
        );
    }
    if (toolName === "browser_snapshot" && typeof data.yaml === "string") {
        return (
            <pre className="whitespace-pre font-mono text-[11px] leading-snug text-dark-200">
                {truncate(data.yaml, 1500)}
            </pre>
        );
    }
    if (toolName === "browser_find" && Array.isArray(data.matches)) {
        const matches = data.matches as Array<{
            ref?: number;
            text?: string;
            tag?: string;
        }>;
        if (matches.length === 0) {
            return (
                <p className="text-[11px] italic text-dark-400">No matches.</p>
            );
        }
        return (
            <ul className="space-y-0.5 text-[11px] text-dark-200">
                {matches.slice(0, 25).map((m, i) => (
                    <li key={i} className="truncate">
                        <span className="rounded bg-dark-800 px-1 py-0.5 font-mono text-[10px] text-violet-300">
                            ref={m.ref}
                        </span>{" "}
                        <span className="text-dark-400">{m.tag}</span>{" "}
                        <span>{truncate(m.text ?? "", 120)}</span>
                    </li>
                ))}
            </ul>
        );
    }
    if (toolName === "browser_list_tabs" && Array.isArray(data.tabs)) {
        const tabs = data.tabs as Array<{
            id?: string;
            url?: string;
            title?: string;
            active?: boolean;
        }>;
        if (tabs.length === 0) {
            return (
                <p className="text-[11px] italic text-dark-400">
                    No tabs open.
                </p>
            );
        }
        return (
            <ul className="space-y-0.5 text-[11px] text-dark-200">
                {tabs.map((t) => (
                    <li key={t.id} className="flex items-center gap-1.5 truncate">
                        {t.url && (
                            <img
                                src={faviconUrl(t.url) ?? ""}
                                alt=""
                                className="size-3 shrink-0"
                                onError={(e) => {
                                    (e.currentTarget as HTMLImageElement).style.visibility =
                                        "hidden";
                                }}
                            />
                        )}
                        <span className="truncate">
                            {t.title || t.url || "(blank)"}
                        </span>
                        {t.active && (
                            <span className="ml-auto rounded bg-violet-900/40 px-1 py-px text-[9px] uppercase tracking-wider text-violet-300">
                                active
                            </span>
                        )}
                    </li>
                ))}
            </ul>
        );
    }
    if (
        toolName === "browser_navigate" ||
        toolName === "browser_back" ||
        toolName === "browser_forward" ||
        toolName === "browser_reload"
    ) {
        const finalUrl =
            typeof data.finalUrl === "string" ? data.finalUrl : "";
        if (!finalUrl) return null;
        return (
            <a
                href={finalUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="flex items-center gap-1 text-[11px] text-dark-300 hover:text-dark-100"
            >
                <span className="truncate">{finalUrl}</span>
                <ArrowSquareOutIcon className="size-3 shrink-0" />
            </a>
        );
    }
    if (toolName === "browser_eval" && data.value !== undefined) {
        return (
            <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-snug text-dark-200">
                {truncate(JSON.stringify(data.value, null, 2), 1500)}
            </pre>
        );
    }
    if (toolName === "browser_screenshot") {
        const attachmentId =
            typeof data.attachmentId === "string"
                ? data.attachmentId
                : null;
        const w = typeof data.width === "number" ? data.width : 0;
        const h = typeof data.height === "number" ? data.height : 0;
        return (
            <p className="text-[11px] text-dark-300">
                Screenshot saved {w > 0 && h > 0 ? `(${w}×${h})` : ""}
                {attachmentId
                    ? ` · attachment ${attachmentId.slice(0, 8)}…`
                    : ""}
            </p>
        );
    }
    return null;
}

export function BrowserBlock({ invocation }: BrowserBlockProps) {
    const input = isRecord(invocation.input)
        ? (invocation.input as Record<string, unknown>)
        : undefined;
    const output = isRecord(invocation.output)
        ? (invocation.output as BrowserOutputShape)
        : undefined;

    const toolFailed = output?.ok === false;
    const status: ToolInvocationStatus = toolFailed
        ? "error"
        : invocation.status;
    const error =
        invocation.error ??
        (toolFailed ? (output?.error ?? "Browser op failed") : null);

    const labels = getLabels(invocation.tool_name);
    const detail = formatDetail(invocation.tool_name, input, output);
    const body = renderBody(invocation.tool_name, output);

    return (
        <ToolBlock
            icon={<labels.Icon className="size-3.5" weight="bold" />}
            pendingLabel={labels.pending}
            successLabel={labels.success}
            errorLabel={`${labels.success.replace(/^[A-Z]/, (c) =>
                c.toLowerCase()
            )} failed`}
            deniedLabel={`${labels.success.replace(/^[A-Z]/, (c) =>
                c.toLowerCase()
            )} denied`}
            detail={detail}
            error={error}
            status={status}
        >
            {error ? (
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-red-200">
                    {error}
                </p>
            ) : (
                body
            )}
        </ToolBlock>
    );
}

export function isBrowserToolName(name: string): boolean {
    return name.startsWith("browser_");
}
