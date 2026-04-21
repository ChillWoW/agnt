import { z } from "zod";
import { logger } from "../../../lib/logger";
import type { ToolDefinition, ToolModelOutput } from "./types";

// ─── Config ───────────────────────────────────────────────────────────────────

function readEnv(): {
    url: string | null;
    username: string | null;
    password: string | null;
} {
    const url = process.env.SEARXNG_URL?.trim() || null;
    const username = process.env.SEARXNG_USERNAME?.trim() || null;
    const password = process.env.SEARXNG_PASSWORD?.trim() || null;
    return { url, username, password };
}

function stripTrailingSlash(url: string): string {
    return url.endsWith("/") ? url.slice(0, -1) : url;
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const MAX_RESULTS_CAP = 20;
const DEFAULT_MAX_RESULTS = 8;

export const webSearchInputSchema = z.object({
    query: z
        .string()
        .min(1)
        .describe(
            "Search query. Supports engine-specific operators (e.g. `site:github.com` for Google/DDG). Be specific; favour natural-language questions over single-word searches."
        ),
    maxResults: z
        .number()
        .int()
        .positive()
        .max(MAX_RESULTS_CAP)
        .optional()
        .describe(
            `Maximum number of results to return. Defaults to ${DEFAULT_MAX_RESULTS}; hard cap is ${MAX_RESULTS_CAP}.`
        ),
    categories: z
        .string()
        .optional()
        .describe(
            "Comma-separated list of SearXNG categories (e.g. `general`, `news`, `images`, `videos`, `it`). Omit to use the instance default."
        ),
    language: z
        .string()
        .optional()
        .describe(
            "Language code (e.g. `en`, `en-US`, `fr`). Omit to use the instance default."
        ),
    timeRange: z
        .enum(["day", "month", "year"])
        .optional()
        .describe(
            "Restrict results to the given time window. Only honoured by engines that support time-range filtering."
        ),
    safesearch: z
        .union([z.literal(0), z.literal(1), z.literal(2)])
        .optional()
        .describe(
            "Safesearch level: 0 = off, 1 = moderate, 2 = strict. Omit to use the instance default."
        )
});

export type WebSearchInput = z.infer<typeof webSearchInputSchema>;

// ─── Output shape ─────────────────────────────────────────────────────────────

export interface WebSearchResultItem {
    title: string;
    url: string;
    content: string;
    engine: string | null;
    score: number | null;
}

export type WebSearchOutput =
    | {
          ok: true;
          query: string;
          results: WebSearchResultItem[];
          count: number;
          truncated: boolean;
          totalAvailable: number;
      }
    | {
          ok: false;
          error: string;
      };

// ─── SearXNG wire types ───────────────────────────────────────────────────────

interface SearxngRawResult {
    title?: string;
    url?: string;
    content?: string;
    engine?: string;
    engines?: string[];
    score?: number;
}

interface SearxngResponse {
    query?: string;
    results?: SearxngRawResult[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeResult(raw: SearxngRawResult): WebSearchResultItem | null {
    const title =
        typeof raw.title === "string" ? raw.title.trim() : "";
    const url = typeof raw.url === "string" ? raw.url.trim() : "";
    if (url.length === 0) return null;
    const content =
        typeof raw.content === "string" ? raw.content.trim() : "";
    const engine =
        (typeof raw.engine === "string" && raw.engine.length > 0
            ? raw.engine
            : Array.isArray(raw.engines) && raw.engines.length > 0
              ? raw.engines[0] ?? null
              : null) ?? null;
    const score =
        typeof raw.score === "number" && Number.isFinite(raw.score)
            ? raw.score
            : null;

    return {
        title: title.length > 0 ? title : url,
        url,
        content,
        engine,
        score
    };
}

// ─── Execute ──────────────────────────────────────────────────────────────────

async function executeWebSearch(
    input: WebSearchInput
): Promise<WebSearchOutput> {
    const { url: rawBase, username, password } = readEnv();

    if (!rawBase) {
        return {
            ok: false,
            error: "SEARXNG_URL is not configured. Set it in the server .env before using web_search."
        };
    }

    const base = stripTrailingSlash(rawBase);
    const max = Math.min(
        MAX_RESULTS_CAP,
        Math.max(1, input.maxResults ?? DEFAULT_MAX_RESULTS)
    );

    const params = new URLSearchParams();
    params.set("q", input.query);
    params.set("format", "json");
    if (input.categories) params.set("categories", input.categories);
    if (input.language) params.set("language", input.language);
    if (input.timeRange) params.set("time_range", input.timeRange);
    if (typeof input.safesearch === "number") {
        params.set("safesearch", String(input.safesearch));
    }

    const headers: Record<string, string> = {
        Accept: "application/json",
        "User-Agent": "Agnt/1.0 (+web_search)"
    };
    if (username && password) {
        const token = Buffer.from(`${username}:${password}`).toString(
            "base64"
        );
        headers["Authorization"] = `Basic ${token}`;
    }

    let response: Response;
    try {
        response = await fetch(`${base}/search?${params.toString()}`, {
            method: "GET",
            headers
        });
    } catch (error) {
        const message =
            error instanceof Error ? error.message : String(error);
        logger.warn("[tool:web_search] network error", message);
        return {
            ok: false,
            error: `Failed to reach SearXNG at ${base}: ${message}`
        };
    }

    if (!response.ok) {
        let body = "";
        try {
            body = await response.text();
        } catch {
            // ignore
        }
        logger.warn("[tool:web_search] bad response", {
            status: response.status,
            bodyPreview: body.slice(0, 200)
        });
        if (response.status === 401 || response.status === 403) {
            return {
                ok: false,
                error: `SearXNG rejected auth (${response.status}). Check SEARXNG_USERNAME / SEARXNG_PASSWORD.`
            };
        }
        return {
            ok: false,
            error: `SearXNG returned HTTP ${response.status}${
                body.length > 0 ? `: ${body.slice(0, 200)}` : ""
            }`
        };
    }

    let payload: SearxngResponse;
    try {
        payload = (await response.json()) as SearxngResponse;
    } catch (error) {
        const message =
            error instanceof Error ? error.message : String(error);
        return {
            ok: false,
            error: `Could not parse SearXNG JSON response: ${message}. The instance may not have JSON format enabled.`
        };
    }

    const rawResults = Array.isArray(payload.results) ? payload.results : [];
    const normalized = rawResults
        .map(normalizeResult)
        .filter((r): r is WebSearchResultItem => r !== null);

    const totalAvailable = normalized.length;
    const trimmed = normalized.slice(0, max);

    logger.log("[tool:web_search]", {
        query: input.query,
        returned: trimmed.length,
        total: totalAvailable
    });

    return {
        ok: true,
        query: input.query,
        results: trimmed,
        count: trimmed.length,
        truncated: totalAvailable > trimmed.length,
        totalAvailable
    };
}

// ─── Model output transformer ─────────────────────────────────────────────────

function hostnameOf(url: string): string {
    try {
        return new URL(url).hostname;
    } catch {
        return url;
    }
}

function toModelOutput({
    output
}: {
    input: WebSearchInput;
    output: WebSearchOutput;
}): ToolModelOutput {
    if (!output.ok) {
        return {
            type: "text",
            value: `web_search failed: ${output.error}`
        };
    }

    if (output.results.length === 0) {
        return {
            type: "text",
            value: `No results found for "${output.query}".`
        };
    }

    const header =
        `Web search for "${output.query}" — ${output.count} result${
            output.count === 1 ? "" : "s"
        }` +
        (output.truncated
            ? ` (showing top ${output.count} of ${output.totalAvailable})`
            : "");

    const body = output.results
        .map((r, idx) => {
            const host = hostnameOf(r.url);
            const snippet = r.content.length > 400
                ? `${r.content.slice(0, 400).trimEnd()}…`
                : r.content;
            const lines = [
                `${idx + 1}. ${r.title}`,
                `   ${r.url}${host && host !== r.url ? ` (${host})` : ""}`
            ];
            if (snippet.length > 0) {
                lines.push(`   ${snippet.replace(/\s+/g, " ").trim()}`);
            }
            if (r.engine) {
                lines.push(`   engine: ${r.engine}`);
            }
            return lines.join("\n");
        })
        .join("\n\n");

    return {
        type: "text",
        value: `${header}\n\n${body}`
    };
}

// ─── Factory ──────────────────────────────────────────────────────────────────

const TOOL_DESCRIPTION =
    "Search the web via a self-hosted SearXNG instance. Use this for up-to-date information, to find source URLs, or to locate a specific page you can then pass to `web_fetch`. " +
    "Input: { query, maxResults?, categories?, language?, timeRange?, safesearch? }. The query supports engine-specific operators (e.g. `site:` for Google/DDG). " +
    "Returns `{ ok: true, query, results: [{ title, url, content, engine, score }], count, truncated, totalAvailable }` on success, or `{ ok: false, error }` on failure. " +
    "Results contain short snippets only — call `web_fetch` afterwards to read a full page.";

export function createWebSearchToolDef(): ToolDefinition<
    WebSearchInput,
    WebSearchOutput
> {
    return {
        name: "web_search",
        description: TOOL_DESCRIPTION,
        inputSchema: webSearchInputSchema,
        execute: executeWebSearch,
        toModelOutput
    };
}

export const webSearchToolDef = createWebSearchToolDef();
