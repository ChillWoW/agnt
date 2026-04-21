import { z } from "zod";
import { logger } from "../../../lib/logger";
import type { ToolDefinition, ToolModelOutput } from "./types";

// ─── Config ───────────────────────────────────────────────────────────────────

const DEFAULT_CRAWL4AI_URL = "http://localhost:11235";

function readBaseUrl(): string {
    const raw = process.env.CRAWL4AI_URL?.trim();
    const base = raw && raw.length > 0 ? raw : DEFAULT_CRAWL4AI_URL;
    return base.endsWith("/") ? base.slice(0, -1) : base;
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const DEFAULT_MAX_CHARS = 60_000;
const HARD_MAX_CHARS = 200_000;

export const webFetchInputSchema = z.object({
    url: z
        .url()
        .describe(
            "Fully qualified URL to fetch (must include protocol, e.g. https://example.com/page). The page is rendered in a headless browser and returned as cleaned markdown."
        ),
    maxChars: z
        .number()
        .int()
        .positive()
        .max(HARD_MAX_CHARS)
        .optional()
        .describe(
            `Maximum number of markdown characters to return. Defaults to ${DEFAULT_MAX_CHARS}; hard cap is ${HARD_MAX_CHARS}. Extra content is truncated and flagged with truncated=true.`
        )
});

export type WebFetchInput = z.infer<typeof webFetchInputSchema>;

// ─── Output shape ─────────────────────────────────────────────────────────────

export type WebFetchOutput =
    | {
          ok: true;
          url: string;
          finalUrl: string;
          title: string | null;
          description: string | null;
          markdown: string;
          charCount: number;
          truncated: boolean;
          statusCode: number | null;
      }
    | {
          ok: false;
          error: string;
          statusCode: number | null;
      };

// ─── Crawl4AI wire types (loose on purpose) ───────────────────────────────────

interface Crawl4aiMarkdownObject {
    raw_markdown?: string;
    fit_markdown?: string;
    markdown_with_citations?: string;
}

interface Crawl4aiResultRow {
    url?: string;
    redirected_url?: string;
    final_url?: string;
    markdown?: string | Crawl4aiMarkdownObject;
    cleaned_html?: string;
    html?: string;
    metadata?: {
        title?: string;
        description?: string;
        og_title?: string;
        og_description?: string;
    };
    status_code?: number;
    success?: boolean;
    error_message?: string;
}

interface Crawl4aiResponse {
    success?: boolean;
    results?: Crawl4aiResultRow[];
    result?: Crawl4aiResultRow;
    error?: string;
    detail?: string | { msg?: string };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractMarkdown(row: Crawl4aiResultRow): string {
    const md = row.markdown;
    if (typeof md === "string") return md;
    if (md && typeof md === "object") {
        if (typeof md.fit_markdown === "string" && md.fit_markdown.length > 0) {
            return md.fit_markdown;
        }
        if (typeof md.raw_markdown === "string") return md.raw_markdown;
        if (typeof md.markdown_with_citations === "string") {
            return md.markdown_with_citations;
        }
    }
    return "";
}

function extractTitle(row: Crawl4aiResultRow): string | null {
    const m = row.metadata;
    if (!m) return null;
    const candidate =
        (typeof m.title === "string" && m.title.trim()) ||
        (typeof m.og_title === "string" && m.og_title.trim()) ||
        "";
    return candidate.length > 0 ? candidate : null;
}

function extractDescription(row: Crawl4aiResultRow): string | null {
    const m = row.metadata;
    if (!m) return null;
    const candidate =
        (typeof m.description === "string" && m.description.trim()) ||
        (typeof m.og_description === "string" && m.og_description.trim()) ||
        "";
    return candidate.length > 0 ? candidate : null;
}

function pickResultRow(payload: Crawl4aiResponse): Crawl4aiResultRow | null {
    if (Array.isArray(payload.results) && payload.results.length > 0) {
        return payload.results[0] ?? null;
    }
    if (payload.result && typeof payload.result === "object") {
        return payload.result;
    }
    return null;
}

function extractErrorDetail(payload: Crawl4aiResponse, fallback: string): string {
    if (typeof payload.error === "string" && payload.error.length > 0) {
        return payload.error;
    }
    if (typeof payload.detail === "string" && payload.detail.length > 0) {
        return payload.detail;
    }
    if (payload.detail && typeof payload.detail === "object") {
        const msg = payload.detail.msg;
        if (typeof msg === "string" && msg.length > 0) return msg;
    }
    return fallback;
}

// ─── Execute ──────────────────────────────────────────────────────────────────

async function executeWebFetch(input: WebFetchInput): Promise<WebFetchOutput> {
    const base = readBaseUrl();
    const maxChars = Math.min(
        HARD_MAX_CHARS,
        Math.max(1, input.maxChars ?? DEFAULT_MAX_CHARS)
    );

    const body = {
        urls: [input.url],
        browser_config: {
            type: "BrowserConfig",
            params: { headless: true }
        },
        crawler_config: {
            type: "CrawlerRunConfig",
            params: {
                cache_mode: "bypass",
                stream: false
            }
        }
    };

    let response: Response;
    try {
        response = await fetch(`${base}/crawl`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                "User-Agent": "Agnt/1.0 (+web_fetch)"
            },
            body: JSON.stringify(body)
        });
    } catch (error) {
        const message =
            error instanceof Error ? error.message : String(error);
        logger.warn("[tool:web_fetch] network error", message);
        return {
            ok: false,
            error: `Failed to reach Crawl4AI at ${base}: ${message}`,
            statusCode: null
        };
    }

    let payload: Crawl4aiResponse;
    try {
        payload = (await response.json()) as Crawl4aiResponse;
    } catch (error) {
        const message =
            error instanceof Error ? error.message : String(error);
        return {
            ok: false,
            error: `Could not parse Crawl4AI response: ${message}`,
            statusCode: response.status
        };
    }

    if (!response.ok) {
        const detail = extractErrorDetail(
            payload,
            `Crawl4AI returned HTTP ${response.status}`
        );
        logger.warn("[tool:web_fetch] bad response", {
            status: response.status,
            detail
        });
        return {
            ok: false,
            error: detail,
            statusCode: response.status
        };
    }

    const row = pickResultRow(payload);
    if (!row) {
        return {
            ok: false,
            error: extractErrorDetail(
                payload,
                "Crawl4AI returned an empty result set."
            ),
            statusCode: response.status
        };
    }

    if (row.success === false) {
        const reason =
            typeof row.error_message === "string" && row.error_message.length > 0
                ? row.error_message
                : "Crawl4AI failed to render the page.";
        return {
            ok: false,
            error: reason,
            statusCode:
                typeof row.status_code === "number" ? row.status_code : null
        };
    }

    const markdown = extractMarkdown(row);
    const charCount = markdown.length;
    const truncated = charCount > maxChars;
    const body_ = truncated ? markdown.slice(0, maxChars) : markdown;

    const finalUrl =
        (typeof row.redirected_url === "string" && row.redirected_url) ||
        (typeof row.final_url === "string" && row.final_url) ||
        (typeof row.url === "string" && row.url) ||
        input.url;

    logger.log("[tool:web_fetch]", {
        url: input.url,
        finalUrl,
        charCount,
        truncated,
        statusCode: row.status_code ?? null
    });

    return {
        ok: true,
        url: input.url,
        finalUrl,
        title: extractTitle(row),
        description: extractDescription(row),
        markdown: body_,
        charCount,
        truncated,
        statusCode: typeof row.status_code === "number" ? row.status_code : null
    };
}

// ─── Model output transformer ─────────────────────────────────────────────────

function toModelOutput({
    output
}: {
    input: WebFetchInput;
    output: WebFetchOutput;
}): ToolModelOutput {
    if (!output.ok) {
        const statusBit =
            output.statusCode !== null ? ` (HTTP ${output.statusCode})` : "";
        return {
            type: "text",
            value: `web_fetch failed${statusBit}: ${output.error}`
        };
    }

    const headerLines: string[] = [];
    headerLines.push(`Fetched: ${output.finalUrl}`);
    if (output.finalUrl !== output.url) {
        headerLines.push(`Requested: ${output.url}`);
    }
    if (output.title) headerLines.push(`Title: ${output.title}`);
    if (output.description) {
        headerLines.push(`Description: ${output.description}`);
    }
    if (output.statusCode !== null) {
        headerLines.push(`Status: ${output.statusCode}`);
    }
    const totalSuffix = output.truncated
        ? ` (truncated from ${output.charCount} chars — call again with a larger maxChars if you need more)`
        : "";
    headerLines.push(
        `Markdown: ${output.markdown.length} chars${totalSuffix}`
    );

    const header = headerLines.join("\n");
    const body =
        output.markdown.length > 0
            ? `\n\n---\n\n${output.markdown}`
            : "\n\n(No markdown content extracted.)";

    return {
        type: "text",
        value: `${header}${body}`
    };
}

// ─── Factory ──────────────────────────────────────────────────────────────────

const TOOL_DESCRIPTION =
    "Fetch a single URL and return its main content as clean markdown via a local Crawl4AI headless-browser crawler. " +
    "Use this after `web_search` to read a specific result, or whenever the user gives a URL they want you to read. " +
    "Input: { url, maxChars? }. The URL must include a protocol (https://…). " +
    "Returns `{ ok: true, url, finalUrl, title, description, markdown, charCount, truncated, statusCode }` on success, or `{ ok: false, error, statusCode }` on failure. " +
    "Markdown is truncated at `maxChars` (default 60 000, hard cap 200 000) — prefer smaller values when you only need a summary.";

export function createWebFetchToolDef(): ToolDefinition<
    WebFetchInput,
    WebFetchOutput
> {
    return {
        name: "web_fetch",
        description: TOOL_DESCRIPTION,
        inputSchema: webFetchInputSchema,
        execute: executeWebFetch,
        toModelOutput
    };
}

export const webFetchToolDef = createWebFetchToolDef();
