/**
 * Browser tools — let the LLM drive the right-sidebar webview.
 *
 * The browser itself lives in the Tauri frontend. Each tool here calls
 * `requestBrowserOp(...)` which:
 *   1. Emits an SSE `browser-op-required` event the frontend listens to.
 *   2. Blocks on a Promise until the frontend POSTs a result back via
 *      `/browser-ops/:opId/result` (wired in `conversations.routes.ts`).
 *
 * Tool descriptions deliberately steer the model toward small payloads
 * (read summaries, snapshot for refs, refs for clicks) so we don't burn
 * context on full DOM dumps.
 */

import { z } from "zod";
import { logger } from "../../../../lib/logger";
import {
    requestBrowserOp,
    type BrowserOpResult
} from "../../browser";
import {
    createAttachment,
    linkAttachmentsToMessage
} from "../../../attachments/attachments.service";
import type { ToolDefinition, ToolModelOutput } from "../types";

// ─── Shared helpers ───────────────────────────────────────────────────────

interface BrowserToolContext {
    conversationId: string;
    workspaceId: string;
    getAssistantMessageId?: () => string;
}

function fail(message: string): { ok: false; error: string } {
    return { ok: false, error: message };
}

function clipText(text: string, max: number): string {
    if (text.length <= max) return text;
    return `${text.slice(0, max)}\n\n…[truncated, ${text.length} chars total — call again with a larger maxChars or a different op]`;
}

// Compact preface every tool's text result starts with so the model has a
// quick "where am I?" snapshot without re-asking. Kept tiny (one line).
function locationPreface(meta: BrowserOpMeta | undefined): string {
    if (!meta) return "";
    const parts: string[] = [];
    if (meta.tabId) parts.push(`tab=${meta.tabId.slice(0, 8)}`);
    if (meta.url) parts.push(meta.url);
    if (meta.title) parts.push(`"${meta.title}"`);
    return parts.length > 0 ? `[${parts.join(" · ")}]` : "";
}

interface BrowserOpMeta {
    tabId?: string;
    url?: string;
    title?: string;
}

function isObj(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null;
}

function readMeta(value: unknown): BrowserOpMeta | undefined {
    if (!isObj(value)) return undefined;
    const meta = value.meta;
    if (!isObj(meta)) return undefined;
    const out: BrowserOpMeta = {};
    if (typeof meta.tabId === "string") out.tabId = meta.tabId;
    if (typeof meta.url === "string") out.url = meta.url;
    if (typeof meta.title === "string") out.title = meta.title;
    return out;
}

function readData<T = unknown>(value: unknown): T | undefined {
    if (!isObj(value)) return undefined;
    return value.data as T | undefined;
}

// ─── Tool factory boilerplate ─────────────────────────────────────────────

interface BrowserToolFactoryArgs<TInput extends object, TData> {
    name: string;
    description: string;
    inputSchema: z.ZodType<TInput>;
    /** Op identifier sent to the frontend bridge. */
    op: string;
    /**
     * Builds the gate args + label from the validated input. Most tools
     * just forward their input; some (e.g. screenshot) shape it.
     */
    buildRequest: (input: TInput) => {
        args: Record<string, unknown>;
        tabIdHint?: string;
        label: string;
    };
    /**
     * Renders the browser-op result into a `ToolModelOutput`. Defaults to a
     * compact text payload built from the meta preface + JSON of `data`.
     */
    renderOutput?: (
        result: BrowserOpToolOutput<TData>,
        ctx: BrowserToolContext
    ) => Promise<ToolModelOutput> | ToolModelOutput;
}

export type BrowserOpToolOutput<TData = unknown> =
    | { ok: true; meta?: BrowserOpMeta; data: TData }
    | { ok: false; error: string };

function createBrowserTool<TInput extends object, TData>(
    ctx: BrowserToolContext,
    args: BrowserToolFactoryArgs<TInput, TData>
): ToolDefinition<TInput, BrowserOpToolOutput<TData>> {
    return {
        name: args.name,
        description: args.description,
        inputSchema: args.inputSchema,
        async execute(input: TInput): Promise<BrowserOpToolOutput<TData>> {
            const { args: gateArgs, tabIdHint, label } = args.buildRequest(input);
            let result: BrowserOpResult;
            try {
                result = await requestBrowserOp({
                    conversationId: ctx.conversationId,
                    op: args.op as never,
                    args: gateArgs,
                    tabIdHint,
                    label
                });
            } catch (error) {
                const message =
                    error instanceof Error ? error.message : String(error);
                logger.warn(`[tool:${args.name}] gate failed`, message);
                return fail(message);
            }

            if (!result.ok) return fail(result.error);

            const meta = readMeta(result.result);
            const data = readData<TData>(result.result);
            return {
                ok: true,
                meta,
                data: (data ?? ({} as TData)) as TData
            };
        },
        toModelOutput: async ({ output }) => {
            if (args.renderOutput) {
                return args.renderOutput(output, ctx);
            }
            if (!output.ok) {
                return {
                    type: "text",
                    value: `${args.name} failed: ${output.error}`
                };
            }
            const preface = locationPreface(output.meta);
            const body = JSON.stringify(output.data, null, 2);
            return {
                type: "text",
                value: preface ? `${preface}\n${body}` : body
            };
        }
    };
}

// ─── Schemas ──────────────────────────────────────────────────────────────

const tabIdField = z
    .string()
    .min(1)
    .optional()
    .describe(
        "Optional tab id to act on. Omit to use this conversation's auto-managed agent tab (created on first call). Use `browser_list_tabs` to discover other tab ids."
    );

const refField = z
    .number()
    .int()
    .nonnegative()
    .describe(
        "An interactive element ref returned by a previous `browser_snapshot` or `browser_find` call. Refs are scoped to the most recent snapshot of THIS tab — re-snapshot if the page may have changed."
    );

// ─── Tool: list_tabs ──────────────────────────────────────────────────────

const listTabsInputSchema = z.object({});

interface ListTabsData {
    tabs: Array<{
        id: string;
        url: string;
        title: string;
        loading: boolean;
        active: boolean;
    }>;
}

function createListTabsTool(ctx: BrowserToolContext) {
    return createBrowserTool<z.infer<typeof listTabsInputSchema>, ListTabsData>(
        ctx,
        {
            name: "browser_list_tabs",
            description:
                "List every browser tab currently open in the right-sidebar (both user-opened and agent-opened). " +
                "Returns `{ ok: true, data: { tabs: [{id, url, title, loading, active}] } }`. " +
                "Cheap call (no DOM walk). Use this to discover tab ids before targeting a specific tab with the other browser_* tools.",
            inputSchema: listTabsInputSchema,
            op: "list_tabs",
            buildRequest: () => ({ args: {}, label: "listing browser tabs" })
        }
    );
}

// ─── Tool: open_tab ───────────────────────────────────────────────────────

const openTabInputSchema = z.object({
    url: z
        .string()
        .min(1)
        .optional()
        .describe(
            "Optional initial URL. Plain text without a scheme is treated as a Google search; bare hosts get `https://` prepended. Omit to open a blank tab."
        )
});

interface OpenTabData {
    tabId: string;
    url: string;
}

function createOpenTabTool(ctx: BrowserToolContext) {
    return createBrowserTool<z.infer<typeof openTabInputSchema>, OpenTabData>(
        ctx,
        {
            name: "browser_open_tab",
            description:
                "Open a new browser tab in the right-sidebar. " +
                "Input: `{ url? }`. Returns `{ ok: true, data: { tabId, url } }`. " +
                "Prefer reusing an existing tab via `tabId` on subsequent calls instead of opening fresh tabs each time.",
            inputSchema: openTabInputSchema,
            op: "open_tab",
            buildRequest: (input) => ({
                args: { url: input.url ?? "" },
                label: input.url ? `opening ${input.url}` : "opening new tab"
            })
        }
    );
}

// ─── Tool: close_tab ──────────────────────────────────────────────────────

const closeTabInputSchema = z.object({
    tabId: z.string().min(1).describe("Tab id to close.")
});

function createCloseTabTool(ctx: BrowserToolContext) {
    return createBrowserTool<z.infer<typeof closeTabInputSchema>, { closed: boolean }>(
        ctx,
        {
            name: "browser_close_tab",
            description:
                "Close a browser tab. Input: `{ tabId }`. " +
                "Returns `{ ok: true, data: { closed: true } }`. Closing the active tab focuses a neighbour automatically.",
            inputSchema: closeTabInputSchema,
            op: "close_tab",
            buildRequest: (input) => ({
                args: { tabId: input.tabId },
                tabIdHint: input.tabId,
                label: "closing tab"
            })
        }
    );
}

// ─── Tool: navigate ───────────────────────────────────────────────────────

const navigateInputSchema = z.object({
    tabId: tabIdField,
    url: z
        .string()
        .min(1)
        .describe(
            "Destination URL. Plain text without a scheme is treated as a Google search; bare hosts get `https://` prepended (matches the URL-bar behaviour)."
        )
});

interface NavigateData {
    finalUrl: string;
    title: string;
    statusCode?: number | null;
}

function createNavigateTool(ctx: BrowserToolContext) {
    return createBrowserTool<z.infer<typeof navigateInputSchema>, NavigateData>(
        ctx,
        {
            name: "browser_navigate",
            description:
                "Navigate a tab to a URL (creates the agent tab if `tabId` is omitted). " +
                "Input: `{ tabId?, url }`. Returns `{ ok: true, data: { finalUrl, title, statusCode? } }`. " +
                "Wait for the load to settle (this tool already waits for `DOMContentLoaded`); call `browser_read` or `browser_snapshot` afterwards to inspect the new page.",
            inputSchema: navigateInputSchema,
            op: "navigate",
            buildRequest: (input) => ({
                args: { url: input.url },
                tabIdHint: input.tabId,
                label: `navigating to ${input.url}`
            })
        }
    );
}

// ─── Tool: back / forward / reload ────────────────────────────────────────

const navOnlyInputSchema = z.object({ tabId: tabIdField });

function createBackTool(ctx: BrowserToolContext) {
    return createBrowserTool<z.infer<typeof navOnlyInputSchema>, NavigateData>(
        ctx,
        {
            name: "browser_back",
            description:
                "Go back one entry in the tab's history. Input: `{ tabId? }`. Returns the new `{ finalUrl, title }`.",
            inputSchema: navOnlyInputSchema,
            op: "back",
            buildRequest: (input) => ({
                args: {},
                tabIdHint: input.tabId,
                label: "going back"
            })
        }
    );
}

function createForwardTool(ctx: BrowserToolContext) {
    return createBrowserTool<z.infer<typeof navOnlyInputSchema>, NavigateData>(
        ctx,
        {
            name: "browser_forward",
            description:
                "Go forward one entry in the tab's history. Input: `{ tabId? }`. Returns `{ finalUrl, title }`.",
            inputSchema: navOnlyInputSchema,
            op: "forward",
            buildRequest: (input) => ({
                args: {},
                tabIdHint: input.tabId,
                label: "going forward"
            })
        }
    );
}

function createReloadTool(ctx: BrowserToolContext) {
    return createBrowserTool<z.infer<typeof navOnlyInputSchema>, NavigateData>(
        ctx,
        {
            name: "browser_reload",
            description:
                "Reload the tab. Input: `{ tabId? }`. Returns `{ finalUrl, title }`.",
            inputSchema: navOnlyInputSchema,
            op: "reload",
            buildRequest: (input) => ({
                args: {},
                tabIdHint: input.tabId,
                label: "reloading"
            })
        }
    );
}

// ─── Tool: read ───────────────────────────────────────────────────────────

const READ_DEFAULT_MAX = 8000;
const READ_HARD_MAX = 40000;

const readInputSchema = z.object({
    tabId: tabIdField,
    maxChars: z
        .number()
        .int()
        .positive()
        .max(READ_HARD_MAX)
        .optional()
        .describe(
            `Char cap on the returned markdown. Default ${READ_DEFAULT_MAX}, hard cap ${READ_HARD_MAX}. Keep this small — only raise if the first read was clearly truncated mid-content.`
        )
});

interface ReadData {
    markdown: string;
    charCount: number;
    truncated: boolean;
}

function createReadTool(ctx: BrowserToolContext) {
    return createBrowserTool<z.infer<typeof readInputSchema>, ReadData>(ctx, {
        name: "browser_read",
        description:
            "Read the main content of a page as cleaned markdown (Readability-style: drops nav/footer/ads, keeps headings + paragraphs + lists). " +
            "Input: `{ tabId?, maxChars? }`. Returns `{ ok: true, meta:{tabId,url,title}, data: { markdown, charCount, truncated } }`. " +
            "Prefer this over `browser_snapshot` for reading content — it's much smaller. Use `browser_snapshot` only when you need to interact with elements.",
        inputSchema: readInputSchema,
        op: "read",
        buildRequest: (input) => ({
            args: { maxChars: input.maxChars ?? READ_DEFAULT_MAX },
            tabIdHint: input.tabId,
            label: "reading page"
        }),
        renderOutput: (output) => {
            if (!output.ok) {
                return {
                    type: "text",
                    value: `browser_read failed: ${output.error}`
                };
            }
            const preface = locationPreface(output.meta);
            const data = output.data;
            const md = data.markdown ?? "";
            const truncSuffix = data.truncated
                ? ` (truncated from ${data.charCount} chars)`
                : "";
            const header = preface
                ? `${preface}\n${md.length} chars${truncSuffix}\n\n---`
                : `${md.length} chars${truncSuffix}\n---`;
            return {
                type: "text",
                value: `${header}\n\n${md}`
            };
        }
    });
}

// ─── Tool: snapshot ───────────────────────────────────────────────────────

const SNAPSHOT_DEFAULT_MAX = 6000;
const SNAPSHOT_HARD_MAX = 30000;

const snapshotInputSchema = z.object({
    tabId: tabIdField,
    maxChars: z
        .number()
        .int()
        .positive()
        .max(SNAPSHOT_HARD_MAX)
        .optional()
        .describe(
            `Char cap on the YAML snapshot. Default ${SNAPSHOT_DEFAULT_MAX}, hard cap ${SNAPSHOT_HARD_MAX}.`
        )
});

interface SnapshotData {
    yaml: string;
    charCount: number;
    truncated: boolean;
    refCount: number;
}

function createSnapshotTool(ctx: BrowserToolContext) {
    return createBrowserTool<z.infer<typeof snapshotInputSchema>, SnapshotData>(
        ctx,
        {
            name: "browser_snapshot",
            description:
                "Capture a compact YAML accessibility snapshot of the page with `[ref=N]` ids on every interactive element (links, buttons, inputs, [role=*], [contenteditable]). " +
                "Use the refs in subsequent `browser_click` / `browser_type` / `browser_scroll` calls. " +
                "Input: `{ tabId?, maxChars? }`. Returns `{ ok: true, meta, data: { yaml, charCount, truncated, refCount } }`. " +
                "Refs are scoped to the most recent snapshot of THIS tab — if the page changes, re-snapshot before clicking.",
            inputSchema: snapshotInputSchema,
            op: "snapshot",
            buildRequest: (input) => ({
                args: { maxChars: input.maxChars ?? SNAPSHOT_DEFAULT_MAX },
                tabIdHint: input.tabId,
                label: "snapshotting page"
            }),
            renderOutput: (output) => {
                if (!output.ok) {
                    return {
                        type: "text",
                        value: `browser_snapshot failed: ${output.error}`
                    };
                }
                const preface = locationPreface(output.meta);
                const d = output.data;
                const yaml = d.yaml ?? "";
                const trunc = d.truncated
                    ? ` (truncated from ${d.charCount} chars)`
                    : "";
                const header = `${preface}\n${d.refCount} refs · ${yaml.length} chars${trunc}\n---`;
                return {
                    type: "text",
                    value: `${header}\n\n${yaml}`
                };
            }
        }
    );
}

// ─── Tool: find ───────────────────────────────────────────────────────────

const findInputSchema = z.object({
    tabId: tabIdField,
    query: z
        .string()
        .min(1)
        .describe("Plain-text query (case-insensitive substring match)."),
    maxResults: z
        .number()
        .int()
        .positive()
        .max(50)
        .optional()
        .describe("Max number of matches to return (default 10).")
});

interface FindData {
    matches: Array<{ ref: number; text: string; tag: string }>;
}

function createFindTool(ctx: BrowserToolContext) {
    return createBrowserTool<z.infer<typeof findInputSchema>, FindData>(ctx, {
        name: "browser_find",
        description:
            "Find visible text matches on the page and return their refs. " +
            "Input: `{ tabId?, query, maxResults? }`. Returns `{ ok: true, data: { matches: [{ref, text, tag}] } }`. " +
            "Cheaper than a full `browser_snapshot` when you already know the text you want to click.",
        inputSchema: findInputSchema,
        op: "find",
        buildRequest: (input) => ({
            args: { query: input.query, maxResults: input.maxResults ?? 10 },
            tabIdHint: input.tabId,
            label: `finding "${input.query.slice(0, 40)}"`
        })
    });
}

// ─── Tool: click ──────────────────────────────────────────────────────────

const clickInputSchema = z.object({
    tabId: tabIdField,
    ref: refField
});

function createClickTool(ctx: BrowserToolContext) {
    return createBrowserTool<
        z.infer<typeof clickInputSchema>,
        { clicked: boolean; navigated: boolean }
    >(ctx, {
        name: "browser_click",
        description:
            "Click an element by ref. Input: `{ tabId?, ref }`. " +
            "Refs come from `browser_snapshot` or `browser_find`. " +
            "Returns `{ ok: true, data: { clicked, navigated } }` — the tool waits up to 2s for any navigation triggered by the click.",
        inputSchema: clickInputSchema,
        op: "click",
        buildRequest: (input) => ({
            args: { ref: input.ref },
            tabIdHint: input.tabId,
            label: `clicking ref=${input.ref}`
        })
    });
}

// ─── Tool: type ───────────────────────────────────────────────────────────

const typeInputSchema = z.object({
    tabId: tabIdField,
    ref: refField,
    text: z.string().describe("Text to type into the field."),
    submit: z
        .boolean()
        .optional()
        .describe(
            "If true, presses Enter (or `form.requestSubmit()` for inputs in a form) after typing."
        )
});

function createTypeTool(ctx: BrowserToolContext) {
    return createBrowserTool<
        z.infer<typeof typeInputSchema>,
        { typed: boolean; submitted: boolean }
    >(ctx, {
        name: "browser_type",
        description:
            "Type text into an input/textarea/contenteditable by ref. " +
            "Input: `{ tabId?, ref, text, submit? }`. " +
            "Replaces the field's current value, fires `input`/`change` events, optionally submits the form. " +
            "Returns `{ ok: true, data: { typed, submitted } }`.",
        inputSchema: typeInputSchema,
        op: "type",
        buildRequest: (input) => ({
            args: {
                ref: input.ref,
                text: input.text,
                submit: input.submit ?? false
            },
            tabIdHint: input.tabId,
            label: `typing into ref=${input.ref}`
        })
    });
}

// ─── Tool: press_key ──────────────────────────────────────────────────────

const pressKeyInputSchema = z.object({
    tabId: tabIdField,
    key: z
        .string()
        .min(1)
        .describe(
            "Key name as it appears on `KeyboardEvent.key` — e.g. `Enter`, `Escape`, `ArrowDown`, `Tab`, `a`, `Backspace`."
        ),
    ref: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe(
            "Optional ref of the element to dispatch the keypress against. Omit to send to `document.activeElement`."
        )
});

function createPressKeyTool(ctx: BrowserToolContext) {
    return createBrowserTool<
        z.infer<typeof pressKeyInputSchema>,
        { pressed: boolean }
    >(ctx, {
        name: "browser_press_key",
        description:
            "Send a single keyboard key to the page (or to a specific element by ref). " +
            "Input: `{ tabId?, key, ref? }`. Returns `{ ok: true, data: { pressed: true } }`.",
        inputSchema: pressKeyInputSchema,
        op: "press_key",
        buildRequest: (input) => ({
            args: { key: input.key, ref: input.ref ?? null },
            tabIdHint: input.tabId,
            label: `pressing ${input.key}`
        })
    });
}

// ─── Tool: scroll ─────────────────────────────────────────────────────────

const scrollInputSchema = z.object({
    tabId: tabIdField,
    direction: z
        .enum(["up", "down", "top", "bottom"])
        .optional()
        .describe(
            "Coarse scroll command. `up` / `down` scroll one viewport. `top` / `bottom` jump to the page extremes. Mutually exclusive with `toRef`."
        ),
    toRef: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe("Scroll a specific element by ref into view. Mutually exclusive with `direction`.")
});

function createScrollTool(ctx: BrowserToolContext) {
    return createBrowserTool<
        z.infer<typeof scrollInputSchema>,
        { scrolled: boolean; scrollY: number }
    >(ctx, {
        name: "browser_scroll",
        description:
            "Scroll the page (or scroll an element into view). " +
            "Input: `{ tabId?, direction?: 'up'|'down'|'top'|'bottom', toRef? }`. Provide exactly one of `direction` or `toRef`. " +
            "Returns `{ ok: true, data: { scrolled, scrollY } }`.",
        inputSchema: scrollInputSchema,
        op: "scroll",
        buildRequest: (input) => ({
            args: {
                direction: input.direction ?? null,
                toRef: input.toRef ?? null
            },
            tabIdHint: input.tabId,
            label:
                input.toRef !== undefined
                    ? `scrolling to ref=${input.toRef}`
                    : `scrolling ${input.direction ?? "down"}`
        })
    });
}

// ─── Tool: wait_for ───────────────────────────────────────────────────────

const waitForInputSchema = z
    .object({
        tabId: tabIdField,
        text: z
            .string()
            .min(1)
            .optional()
            .describe("Wait until visible text on the page contains this substring."),
        ref: z
            .number()
            .int()
            .nonnegative()
            .optional()
            .describe("Wait until the element behind this ref is visible."),
        navigation: z
            .boolean()
            .optional()
            .describe("Wait for the next top-level navigation to complete."),
        timeoutMs: z
            .number()
            .int()
            .positive()
            .max(30000)
            .optional()
            .describe("Timeout in ms (default 8000, hard cap 30000).")
    })
    .refine(
        (v) => Boolean(v.text || v.navigation || v.ref !== undefined),
        "Provide one of `text`, `ref`, or `navigation: true`."
    );

function createWaitForTool(ctx: BrowserToolContext) {
    return createBrowserTool<
        z.infer<typeof waitForInputSchema>,
        { matched: boolean; reason?: string }
    >(ctx, {
        name: "browser_wait_for",
        description:
            "Wait for a condition (text, ref, or navigation) before proceeding. " +
            "Input: `{ tabId?, text?, ref?, navigation?, timeoutMs? }`. Provide exactly one of the wait conditions. " +
            "Returns `{ ok: true, data: { matched, reason? } }`. On timeout, returns `{ ok: false, error: 'timeout' }`.",
        inputSchema: waitForInputSchema,
        op: "wait_for",
        buildRequest: (input) => ({
            args: {
                text: input.text ?? null,
                ref: input.ref ?? null,
                navigation: input.navigation ?? false,
                timeoutMs: input.timeoutMs ?? 8000
            },
            tabIdHint: input.tabId,
            label: input.text
                ? `waiting for "${input.text.slice(0, 30)}"`
                : input.navigation
                  ? "waiting for navigation"
                  : `waiting for ref=${input.ref}`
        })
    });
}

// ─── Tool: get_state ──────────────────────────────────────────────────────

const getStateInputSchema = z.object({ tabId: tabIdField });

interface StateData {
    url: string;
    title: string;
    scrollX: number;
    scrollY: number;
    readyState: string;
    loading: boolean;
}

function createGetStateTool(ctx: BrowserToolContext) {
    return createBrowserTool<z.infer<typeof getStateInputSchema>, StateData>(
        ctx,
        {
            name: "browser_get_state",
            description:
                "Lightweight status read of a tab: `{url, title, scrollX, scrollY, readyState, loading}`. Cheap — no DOM walk. " +
                "Input: `{ tabId? }`. Use this to confirm a navigation finished, or to inspect scroll position.",
            inputSchema: getStateInputSchema,
            op: "get_state",
            buildRequest: (input) => ({
                args: {},
                tabIdHint: input.tabId,
                label: "checking page state"
            })
        }
    );
}

// ─── Tool: screenshot (gated) ─────────────────────────────────────────────

const screenshotInputSchema = z.object({
    tabId: tabIdField,
    fullPage: z
        .boolean()
        .optional()
        .describe(
            "If true, attempts a full-page capture by scrolling first. Best-effort: WebView2 may still cap at the viewport size."
        )
});

interface ScreenshotData {
    /** Base64 PNG bytes (no data: prefix). */
    pngBase64: string;
    width: number;
    height: number;
}

function createScreenshotTool(ctx: BrowserToolContext) {
    return createBrowserTool<
        z.infer<typeof screenshotInputSchema>,
        {
            attachmentId?: string;
            fileName?: string;
            mimeType?: string;
            width: number;
            height: number;
        }
    >(ctx, {
        name: "browser_screenshot",
        description:
            "Take a PNG screenshot of the tab and attach it to the conversation. " +
            "Input: `{ tabId?, fullPage? }`. Returns `{ ok: true, data: { attachmentId, fileName, mimeType, width, height } }`. " +
            "Use sparingly — images cost ~10x more context than text. Prefer `browser_read` / `browser_snapshot` first; reach for screenshot only when the visual layout itself matters (e.g. confirming a chart rendered correctly).",
        inputSchema: screenshotInputSchema,
        op: "screenshot",
        buildRequest: (input) => ({
            args: { fullPage: input.fullPage ?? false },
            tabIdHint: input.tabId,
            label: "screenshotting"
        }),
        renderOutput: async (output, toolCtx) => {
            if (!output.ok) {
                return {
                    type: "text",
                    value: `browser_screenshot failed: ${output.error}`
                };
            }

            const data = output.data as unknown as ScreenshotData;
            const b64 = typeof data.pngBase64 === "string" ? data.pngBase64 : "";
            if (!b64) {
                return {
                    type: "text",
                    value: "browser_screenshot returned no image data."
                };
            }

            try {
                const buffer = Buffer.from(b64, "base64");
                const fileName = `browser-screenshot-${Date.now()}.png`;
                const file = new File([buffer], fileName, {
                    type: "image/png"
                });
                const attachment = await createAttachment(
                    toolCtx.workspaceId,
                    file
                );
                const messageId = toolCtx.getAssistantMessageId?.() ?? "";
                if (messageId) {
                    try {
                        linkAttachmentsToMessage(
                            toolCtx.workspaceId,
                            [attachment.id],
                            toolCtx.conversationId,
                            messageId
                        );
                    } catch (linkError) {
                        logger.warn(
                            "[tool:browser_screenshot] link failed",
                            linkError
                        );
                    }
                }

                const preface = locationPreface(output.meta);
                return {
                    type: "content",
                    value: [
                        {
                            type: "text",
                            text: `${preface}\nScreenshot saved (${data.width}x${data.height}, attachment ${attachment.id})`
                        },
                        {
                            type: "image-data",
                            data: b64,
                            mediaType: "image/png"
                        }
                    ]
                };
            } catch (err) {
                const message =
                    err instanceof Error ? err.message : String(err);
                logger.error(
                    "[tool:browser_screenshot] persist failed",
                    message
                );
                return {
                    type: "text",
                    value: `browser_screenshot captured but failed to save: ${message}`
                };
            }
        }
    });
}

// ─── Tool: eval (gated, dangerous) ────────────────────────────────────────

const evalInputSchema = z.object({
    tabId: tabIdField,
    expression: z
        .string()
        .min(1)
        .describe(
            "JavaScript expression to evaluate in the page's context. The result is JSON-serialised before being returned (functions/symbols/cycles become null). KEEP IT SHORT — this is for sanity checks, NOT for full scraping."
        )
});

function createEvalTool(ctx: BrowserToolContext) {
    return createBrowserTool<
        z.infer<typeof evalInputSchema>,
        { value: unknown; valueType: string }
    >(ctx, {
        name: "browser_eval",
        description:
            "DANGEROUS: evaluate arbitrary JavaScript in the page's context. " +
            "Input: `{ tabId?, expression }`. Returns `{ ok: true, data: { value, valueType } }` with the JSON-serialised result. " +
            "Use only when no other browser_* tool fits (e.g. extracting `JSON.parse(...)` from a `<script>` or hitting an in-page object). " +
            "Prefer `browser_read` / `browser_snapshot` / `browser_find` for everything else — they're safer and cheaper.",
        inputSchema: evalInputSchema,
        op: "eval",
        buildRequest: (input) => ({
            args: { expression: input.expression },
            tabIdHint: input.tabId,
            label: "evaluating JS"
        }),
        renderOutput: (output) => {
            if (!output.ok) {
                return {
                    type: "text",
                    value: `browser_eval failed: ${output.error}`
                };
            }
            const preface = locationPreface(output.meta);
            const body = JSON.stringify(output.data, null, 2);
            return {
                type: "text",
                value: clipText(
                    preface ? `${preface}\n${body}` : body,
                    20000
                )
            };
        }
    });
}

// ─── Aggregation ──────────────────────────────────────────────────────────

export function createBrowserToolDefs(
    ctx: BrowserToolContext
): ToolDefinition[] {
    return [
        createListTabsTool(ctx),
        createOpenTabTool(ctx),
        createCloseTabTool(ctx),
        createNavigateTool(ctx),
        createBackTool(ctx),
        createForwardTool(ctx),
        createReloadTool(ctx),
        createReadTool(ctx),
        createSnapshotTool(ctx),
        createFindTool(ctx),
        createClickTool(ctx),
        createTypeTool(ctx),
        createPressKeyTool(ctx),
        createScrollTool(ctx),
        createWaitForTool(ctx),
        createGetStateTool(ctx),
        createScreenshotTool(ctx),
        createEvalTool(ctx)
    ] as ToolDefinition[];
}

// Default-export "stub" defs (for `AGNT_TOOL_DEFS` registry entries that
// just need name + description + schema — `buildConversationTools` swaps
// them for context-bound versions).
const STUB_CTX: BrowserToolContext = {
    conversationId: "",
    workspaceId: "",
    getAssistantMessageId: () => ""
};

export const BROWSER_TOOL_DEFS: readonly ToolDefinition[] =
    createBrowserToolDefs(STUB_CTX);

export const BROWSER_TOOL_NAMES: readonly string[] = BROWSER_TOOL_DEFS.map(
    (d) => d.name
);

/**
 * Browser tools that are read-only and side-effect-free. We keep these on
 * `allow` by default so the agent can browse without prompting. Mutating
 * tools (navigate/click/type/eval/screenshot/...) stay on `ask`.
 */
export const BROWSER_READ_ONLY_TOOL_NAMES: readonly string[] = [
    "browser_list_tabs",
    "browser_read",
    "browser_snapshot",
    "browser_find",
    "browser_get_state"
];
