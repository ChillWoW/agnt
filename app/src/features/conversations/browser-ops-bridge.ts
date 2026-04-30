/**
 * Browser-ops bridge.
 *
 * The server's `browser_*` tools emit `browser-op-required` SSE events
 * carrying `{id (opId), op, args, tabIdHint, label}`. This bridge:
 *
 *   1. Picks a target tab (hint, else the conversation's auto-managed
 *      "agent tab").
 *   2. Marks the tab as AI-controlled so the right-sidebar can show the
 *      glow ring + status pill.
 *   3. Reveals the right sidebar (auto-show) and switches the active
 *      pane to that tab so the user can watch.
 *   4. Asks the preload's `__agnt_browser__.__run(...)` to execute the
 *      op via `evalBrowser`.
 *   5. Listens for the preload's `browser://op-result` Tauri event and
 *      POSTs the JSON result to the server's
 *      `/browser-ops/:opId/result` endpoint.
 *
 * `browser-op-resolved` server SSE clears the AI-controlled marker.
 *
 * Designed to be a singleton — call `ensureBrowserOpsBridge()` once at
 * startup. Listening multiple times would just produce duplicate POSTs.
 */

import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { api } from "@/lib/api";
import {
    ensureBrowserOpened,
    isBrowserOpened
} from "@/features/right-sidebar/browser/browser-session";
import { useBrowserStore } from "@/features/right-sidebar/browser/browser-store";
import { useBrowserAiStore } from "@/features/right-sidebar/browser/browser-ai-store";
import { evalBrowser } from "@/features/right-sidebar/browser/browser-bridge";
import { useRightSidebarStore } from "@/features/right-sidebar/right-sidebar-store";
import { useOpenedFilesStore } from "@/features/right-sidebar/filetree";

interface BrowserOpRequiredEvent {
    id: string;
    messageId: string;
    op: string;
    args: Record<string, unknown>;
    tabIdHint: string | null;
    label: string;
    createdAt: string;
}

interface BrowserOpResolvedEvent {
    id: string;
    messageId: string;
    ok: boolean;
    error: string | null;
}

interface BrowserOpResultPayload {
    tabId: string;
    opId: string;
    ok: boolean;
    result?: unknown;
    error?: string;
}

interface PendingOpRecord {
    opId: string;
    tabId: string;
    conversationId: string;
    workspaceId: string;
}

const pendingByOpId = new Map<string, PendingOpRecord>();
/** Per-conversation reusable "agent tab" — created lazily on first op. */
const agentTabByConversationId = new Map<string, string>();

let initialized = false;
let unlistenOpResult: UnlistenFn | null = null;

async function postOpResult(
    workspaceId: string,
    conversationId: string,
    opId: string,
    payload: { ok: boolean; result?: unknown; error?: string }
): Promise<void> {
    try {
        await api.post(
            `/workspaces/${workspaceId}/conversations/${conversationId}/browser-ops/${opId}/result`,
            { body: payload }
        );
    } catch (err) {
        console.error("[browser-ops-bridge] POST result failed", err);
    }
}

function buildEvalScript(
    opId: string,
    op: string,
    args: Record<string, unknown>
): string {
    const payload = JSON.stringify({ opId, op, args });
    // Wrap so we still call back if the namespace isn't ready yet —
    // the preload always reserves it but a freshly-opened webview
    // may race with the eval call.
    return `(function(){
        try {
            var b = window.__agnt_browser__;
            if (!b || typeof b.__run !== 'function') {
                var ipc = window.__TAURI_INTERNALS__;
                if (ipc && typeof ipc.invoke === 'function') {
                    ipc.invoke('browser_op_result', {
                        id: ${JSON.stringify("__pending__")},
                        opId: ${JSON.stringify(opId)},
                        ok: false,
                        error: 'agnt_browser namespace not ready'
                    });
                }
                return;
            }
            b.__run(${payload});
        } catch (e) {
            try {
                var ipc2 = window.__TAURI_INTERNALS__;
                if (ipc2 && typeof ipc2.invoke === 'function') {
                    ipc2.invoke('browser_op_result', {
                        id: '',
                        opId: ${JSON.stringify(opId)},
                        ok: false,
                        error: String(e && e.message ? e.message : e)
                    });
                }
            } catch (_) {}
        }
    })();`;
}

/**
 * Resolve the tab id we should run an op against. If the hint matches
 * an existing tab we use it; otherwise we reuse (or create) the
 * conversation's "agent tab".
 */
async function resolveTargetTab(
    conversationId: string,
    op: string,
    args: Record<string, unknown>,
    tabIdHint: string | null
): Promise<{ tabId: string } | { error: string }> {
    const store = useBrowserStore.getState();

    // op-specific routing for tab-management ops
    if (op === "list_tabs") {
        // `list_tabs` doesn't act on a tab — but we still need to route
        // its eval somewhere. Use the agent tab if it exists, else any
        // open tab; if none exists, the bridge handles it without a tab.
        const existing = store.tabs[0]?.id;
        if (existing) return { tabId: existing };
        const created = await ensureAgentTab(conversationId, "");
        return created;
    }

    if (op === "open_tab") {
        const initialUrl =
            typeof args.url === "string" && args.url.length > 0
                ? args.url
                : "";
        const tab = store.addTab(initialUrl);
        agentTabByConversationId.set(conversationId, tab.id);
        return { tabId: tab.id };
    }

    if (op === "close_tab") {
        const tabId =
            typeof args.tabId === "string" && args.tabId.length > 0
                ? args.tabId
                : null;
        if (!tabId) return { error: "close_tab requires `tabId`" };
        return { tabId };
    }

    // Hint provided and matches an existing tab? Use it.
    if (tabIdHint && store.hasTab(tabIdHint)) {
        return { tabId: tabIdHint };
    }

    // Otherwise resolve / create the agent tab for this conversation.
    return ensureAgentTab(
        conversationId,
        op === "navigate" && typeof args.url === "string" ? args.url : ""
    );
}

async function ensureAgentTab(
    conversationId: string,
    initialUrl: string
): Promise<{ tabId: string }> {
    const store = useBrowserStore.getState();
    const existing = agentTabByConversationId.get(conversationId);
    if (existing && store.hasTab(existing)) {
        return { tabId: existing };
    }
    const tab = store.addTab(initialUrl);
    agentTabByConversationId.set(conversationId, tab.id);
    return { tabId: tab.id };
}

/**
 * Make sure the right sidebar is open and the controlled tab is the
 * active pane, so the user can see what the agent is doing. Best-effort
 * — never throws.
 */
function focusTab(tabId: string): void {
    try {
        useRightSidebarStore.getState().setCollapsed(false);
        useOpenedFilesStore
            .getState()
            .setActive({ kind: "browser", id: tabId });
    } catch (err) {
        console.warn("[browser-ops-bridge] focusTab failed", err);
    }
}

/**
 * Make sure a webview exists for `tabId` so the preload can run our
 * eval. If the tab has no URL yet (open_tab + navigate split into two
 * calls) we just return — the navigate call will open the webview.
 */
async function maybeOpenWebview(tabId: string): Promise<boolean> {
    if (isBrowserOpened(tabId)) return true;

    const tab = useBrowserStore.getState().getTab(tabId);
    if (!tab || !tab.url) {
        return false;
    }

    // We don't have a host placeholder yet (the user might not be
    // looking at this tab), so spawn the webview offscreen with a
    // sensible default size. The first time the user views the tab
    // the placeholder takes over via mountBrowser bounds-sync.
    try {
        await ensureBrowserOpened(tabId, tab.url, {
            x: -10000,
            y: -10000,
            width: 800,
            height: 600
        });
        return true;
    } catch (err) {
        console.error("[browser-ops-bridge] ensureBrowserOpened failed", err);
        return false;
    }
}

export interface DispatchContext {
    conversationId: string;
    workspaceId: string;
}

/**
 * Drive a single browser-op request from the SSE stream end-to-end.
 * Returns immediately after enqueuing the eval; results arrive
 * asynchronously via `browser://op-result`.
 */
export async function dispatchBrowserOp(
    ctx: DispatchContext,
    event: BrowserOpRequiredEvent
): Promise<void> {
    const { conversationId, workspaceId } = ctx;

    const target = await resolveTargetTab(
        conversationId,
        event.op,
        event.args,
        event.tabIdHint
    );

    if ("error" in target) {
        await postOpResult(workspaceId, conversationId, event.id, {
            ok: false,
            error: target.error
        });
        return;
    }

    const tabId = target.tabId;

    useBrowserAiStore.getState().beginOp(tabId, {
        op: event.op,
        label: event.label,
        conversationId
    });

    pendingByOpId.set(event.id, {
        opId: event.id,
        tabId,
        conversationId,
        workspaceId
    });

    focusTab(tabId);

    // Tab-management ops (open_tab / close_tab / list_tabs / navigate
    // when the tab has no URL yet) are handled directly by the bridge
    // without a preload eval.
    if (await dispatchHostOnly(workspaceId, conversationId, event, tabId)) {
        return;
    }

    const opened = await maybeOpenWebview(tabId);
    if (!opened) {
        useBrowserAiStore.getState().endOp(tabId);
        pendingByOpId.delete(event.id);
        await postOpResult(workspaceId, conversationId, event.id, {
            ok: false,
            error:
                "tab has no URL yet — call browser_navigate first or pass a url to browser_open_tab"
        });
        return;
    }

    try {
        await evalBrowser(tabId, buildEvalScript(event.id, event.op, event.args));
    } catch (err) {
        useBrowserAiStore.getState().endOp(tabId);
        pendingByOpId.delete(event.id);
        await postOpResult(workspaceId, conversationId, event.id, {
            ok: false,
            error: err instanceof Error ? err.message : String(err)
        });
    }
}

/**
 * Some ops can be answered immediately from the host side without
 * touching the preload (tab management, screenshot, navigate to a
 * fresh tab). Returns true if the op was handled and we should NOT
 * continue to `evalBrowser`.
 */
async function dispatchHostOnly(
    workspaceId: string,
    conversationId: string,
    event: BrowserOpRequiredEvent,
    tabId: string
): Promise<boolean> {
    const op = event.op;
    const aiStore = useBrowserAiStore.getState();

    if (op === "list_tabs") {
        const tabs = useBrowserStore.getState().tabs;
        const loadingByTab = useBrowserStore.getState().loadingByTabId;
        const activeRecord = useOpenedFilesStore.getState().active;
        const activeId =
            activeRecord.kind === "browser" ? activeRecord.id : null;
        const result = {
            meta: { tabId },
            data: {
                tabs: tabs.map((t) => ({
                    id: t.id,
                    url: t.url,
                    title: t.title,
                    loading: loadingByTab[t.id] ?? false,
                    active: t.id === activeId
                }))
            }
        };
        aiStore.endOp(tabId);
        pendingByOpId.delete(event.id);
        await postOpResult(workspaceId, conversationId, event.id, {
            ok: true,
            result
        });
        return true;
    }

    if (op === "open_tab") {
        const tab = useBrowserStore.getState().getTab(tabId);
        const url = tab?.url ?? "";
        if (url) {
            // Trigger the lazy-open path so the next op can run.
            void maybeOpenWebview(tabId);
        }
        aiStore.endOp(tabId);
        pendingByOpId.delete(event.id);
        await postOpResult(workspaceId, conversationId, event.id, {
            ok: true,
            result: { meta: { tabId, url }, data: { tabId, url } }
        });
        return true;
    }

    if (op === "close_tab") {
        const { closeTab: closeTabAction } = await import(
            "@/features/right-sidebar/browser/browser-actions"
        );
        try {
            await closeTabAction(tabId);
            aiStore.clearTab(tabId);
            pendingByOpId.delete(event.id);
            await postOpResult(workspaceId, conversationId, event.id, {
                ok: true,
                result: { meta: { tabId }, data: { closed: true } }
            });
        } catch (err) {
            aiStore.endOp(tabId);
            pendingByOpId.delete(event.id);
            await postOpResult(workspaceId, conversationId, event.id, {
                ok: false,
                error: err instanceof Error ? err.message : String(err)
            });
        }
        return true;
    }

    if (op === "navigate") {
        const rawUrl = typeof event.args.url === "string" ? event.args.url : "";
        const { resolveUrl, navigateTab } = await import(
            "@/features/right-sidebar/browser/browser-actions"
        );
        const resolved = resolveUrl(rawUrl);
        if (!resolved) {
            aiStore.endOp(tabId);
            pendingByOpId.delete(event.id);
            await postOpResult(workspaceId, conversationId, event.id, {
                ok: false,
                error: "could not resolve url"
            });
            return true;
        }
        try {
            await navigateTab(tabId, resolved);
            // Wait briefly for DOMContentLoaded via the preload's
            // load-state events. We piggy-back on the preload's
            // `__run` after the navigation completes by sending a
            // `wait_for: navigation` op — but doing it inline keeps
            // the bridge simpler. Just give it ~500ms then ask the
            // preload for current state.
            await new Promise((r) => setTimeout(r, 500));
        } catch (err) {
            aiStore.endOp(tabId);
            pendingByOpId.delete(event.id);
            await postOpResult(workspaceId, conversationId, event.id, {
                ok: false,
                error: err instanceof Error ? err.message : String(err)
            });
            return true;
        }
        // Now ensure the webview is opened and ask the preload for
        // url/title via __run get_state.
        const opened = await maybeOpenWebview(tabId);
        if (!opened) {
            aiStore.endOp(tabId);
            pendingByOpId.delete(event.id);
            await postOpResult(workspaceId, conversationId, event.id, {
                ok: false,
                error: "could not open webview after navigate"
            });
            return true;
        }
        // Drive the preload to capture the post-navigation state
        // (title/url/readyState) via the same op_result IPC. Reuse
        // event.id so the post-route resolves the awaiting tool.
        try {
            await evalBrowser(
                tabId,
                buildEvalScript(event.id, "post_navigate", { url: resolved })
            );
            return true;
        } catch (err) {
            aiStore.endOp(tabId);
            pendingByOpId.delete(event.id);
            await postOpResult(workspaceId, conversationId, event.id, {
                ok: false,
                error: err instanceof Error ? err.message : String(err)
            });
            return true;
        }
    }

    if (op === "back" || op === "forward" || op === "reload") {
        const actions = await import(
            "@/features/right-sidebar/browser/browser-actions"
        );
        try {
            if (op === "back") await actions.backTab(tabId);
            else if (op === "forward") await actions.forwardTab(tabId);
            else await actions.reloadTab(tabId);
            await new Promise((r) => setTimeout(r, 500));
            await evalBrowser(
                tabId,
                buildEvalScript(event.id, "post_navigate", {})
            );
            return true;
        } catch (err) {
            aiStore.endOp(tabId);
            pendingByOpId.delete(event.id);
            await postOpResult(workspaceId, conversationId, event.id, {
                ok: false,
                error: err instanceof Error ? err.message : String(err)
            });
            return true;
        }
    }

    if (op === "screenshot") {
        const { invoke } = await import("@tauri-apps/api/core");
        try {
            const png = await invoke<{
                pngBase64: string;
                width: number;
                height: number;
            }>("browser_screenshot", { id: tabId });
            const tab = useBrowserStore.getState().getTab(tabId);
            aiStore.endOp(tabId);
            pendingByOpId.delete(event.id);
            await postOpResult(workspaceId, conversationId, event.id, {
                ok: true,
                result: {
                    meta: {
                        tabId,
                        url: tab?.url ?? "",
                        title: tab?.title ?? ""
                    },
                    data: png
                }
            });
        } catch (err) {
            aiStore.endOp(tabId);
            pendingByOpId.delete(event.id);
            await postOpResult(workspaceId, conversationId, event.id, {
                ok: false,
                error: err instanceof Error ? err.message : String(err)
            });
        }
        return true;
    }

    return false;
}

/**
 * Receive a result payload from the preload (via the
 * `browser_op_result` Tauri command -> `browser://op-result` event)
 * and forward it to the server.
 */
async function onOpResult(payload: BrowserOpResultPayload): Promise<void> {
    const pending = pendingByOpId.get(payload.opId);
    if (!pending) {
        // Could be a stray result from a different parent (or after
        // abort). Drop silently.
        return;
    }

    pendingByOpId.delete(payload.opId);
    useBrowserAiStore.getState().endOp(pending.tabId);

    if (payload.ok) {
        await postOpResult(
            pending.workspaceId,
            pending.conversationId,
            payload.opId,
            { ok: true, result: payload.result }
        );
    } else {
        await postOpResult(
            pending.workspaceId,
            pending.conversationId,
            payload.opId,
            {
                ok: false,
                error: payload.error ?? "browser op failed (no message)"
            }
        );
    }
}

export function handleBrowserOpResolved(
    _conversationId: string,
    event: BrowserOpResolvedEvent
): void {
    // Keep the AI indicator up while the op is running; the result
    // listener clears it. This handler exists for symmetry — the
    // server-side resolved event is mostly informational from the
    // frontend's POV.
    void event;
}

export function ensureBrowserOpsBridge(): void {
    if (initialized) return;
    initialized = true;

    void (async () => {
        try {
            unlistenOpResult = await listen<BrowserOpResultPayload>(
                "browser://op-result",
                (e) => {
                    void onOpResult(e.payload);
                }
            );
        } catch (err) {
            console.error(
                "[browser-ops-bridge] failed to listen for op-result events",
                err
            );
        }
    })();
}

/** Test hook — drop the singleton listener (only used by HMR). */
export function disposeBrowserOpsBridge(): void {
    if (unlistenOpResult) {
        try {
            unlistenOpResult();
        } catch {
            // ignore
        }
        unlistenOpResult = null;
    }
    pendingByOpId.clear();
    agentTabByConversationId.clear();
    useBrowserAiStore.getState().clearAll();
    initialized = false;
}

export type { BrowserOpRequiredEvent, BrowserOpResolvedEvent };
