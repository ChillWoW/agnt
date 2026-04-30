import { logger } from "../../../lib/logger";

/**
 * Server-side gate for "browser_*" tools.
 *
 * The browser lives in the Tauri frontend (right-sidebar webviews), but the
 * LLM tool definitions live on the server. This gate is the bridge: a tool's
 * `execute` enqueues a `BrowserOpRequest` and awaits a Promise that the
 * frontend resolves once it has run the op against the appropriate webview
 * (via the `__agnt_browser__` preload + a POST back).
 *
 * The shape mirrors `questions/gate.ts` so the conversation stream layer can
 * subscribe with the same lifecycle (requested -> resolved) and so abort
 * semantics on stream end stay consistent.
 */

export type BrowserOpName =
    | "list_tabs"
    | "open_tab"
    | "close_tab"
    | "navigate"
    | "back"
    | "forward"
    | "reload"
    | "read"
    | "snapshot"
    | "find"
    | "click"
    | "type"
    | "press_key"
    | "scroll"
    | "wait_for"
    | "get_state"
    | "screenshot"
    | "eval";

export interface BrowserOpRequestInit {
    conversationId: string;
    op: BrowserOpName;
    /** Tool args, forwarded to the frontend bridge as-is. */
    args: Record<string, unknown>;
    /**
     * Optional tab id hint. When omitted, the frontend bridge resolves the
     * conversation's "agent tab" (creating one on first use) so the LLM
     * doesn't have to manage tab ids unless it wants to.
     */
    tabIdHint?: string;
    /**
     * Short human-readable label shown in the "AI is using browser" status
     * pill (e.g. "reading page", "clicking 'Submit'"). Tools provide this
     * so the UI doesn't have to guess from the op name.
     */
    label: string;
}

export interface BrowserOpRequest extends BrowserOpRequestInit {
    id: string;
    createdAt: string;
}

export interface BrowserOpSuccess {
    ok: true;
    /**
     * Op-specific JSON payload. Each tool defines its own shape; the gate
     * doesn't validate beyond "is JSON-serialisable".
     */
    result: unknown;
}

export interface BrowserOpFailure {
    ok: false;
    error: string;
}

export type BrowserOpResult = BrowserOpSuccess | BrowserOpFailure;

interface PendingBrowserOp {
    request: BrowserOpRequest;
    resolve: (result: BrowserOpResult) => void;
    reject: (reason: Error) => void;
}

const pendingById = new Map<string, PendingBrowserOp>();
const pendingByConversation = new Map<string, Set<string>>();

type BrowserOpListener = (event: BrowserOpGateEvent) => void;

export type BrowserOpGateEvent =
    | { type: "requested"; request: BrowserOpRequest }
    | {
          type: "resolved";
          requestId: string;
          ok: boolean;
          /** Present only when ok=true. JSON-serialisable. */
          result?: unknown;
          /** Present only when ok=false. */
          error?: string;
      };

const listenersByConversation = new Map<string, Set<BrowserOpListener>>();

function notify(conversationId: string, event: BrowserOpGateEvent): void {
    const listeners = listenersByConversation.get(conversationId);
    if (!listeners) return;
    for (const listener of listeners) {
        try {
            listener(event);
        } catch (error) {
            logger.error("[browser-op] listener threw", error);
        }
    }
}

export function subscribeToBrowserOps(
    conversationId: string,
    listener: BrowserOpListener
): () => void {
    const set = listenersByConversation.get(conversationId) ?? new Set();
    set.add(listener);
    listenersByConversation.set(conversationId, set);

    return () => {
        const current = listenersByConversation.get(conversationId);
        if (!current) return;
        current.delete(listener);
        if (current.size === 0) {
            listenersByConversation.delete(conversationId);
        }
    };
}

export function requestBrowserOp(
    init: BrowserOpRequestInit
): Promise<BrowserOpResult> {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const request: BrowserOpRequest = { ...init, id, createdAt };

    return new Promise<BrowserOpResult>((resolve, reject) => {
        pendingById.set(id, { request, resolve, reject });

        const perConversation =
            pendingByConversation.get(init.conversationId) ?? new Set();
        perConversation.add(id);
        pendingByConversation.set(init.conversationId, perConversation);

        notify(init.conversationId, { type: "requested", request });
    });
}

export function resolveBrowserOp(
    requestId: string,
    payload: BrowserOpResult
): { ok: true } | { ok: false; error: string } {
    const pending = pendingById.get(requestId);
    if (!pending) {
        return {
            ok: false,
            error: `Browser-op request not found: ${requestId}`
        };
    }

    pendingById.delete(requestId);
    const perConversation = pendingByConversation.get(
        pending.request.conversationId
    );
    perConversation?.delete(requestId);
    if (perConversation && perConversation.size === 0) {
        pendingByConversation.delete(pending.request.conversationId);
    }

    pending.resolve(payload);
    notify(pending.request.conversationId, {
        type: "resolved",
        requestId,
        ok: payload.ok,
        result: payload.ok ? payload.result : undefined,
        error: payload.ok ? undefined : payload.error
    });

    return { ok: true };
}

/**
 * Cancel a single in-flight op. Used when the frontend has decided it
 * cannot fulfil the request (no tabs available, webview crashed, etc.).
 */
export function cancelBrowserOp(
    requestId: string,
    reason = "cancelled"
): { ok: true } | { ok: false; error: string } {
    return resolveBrowserOp(requestId, { ok: false, error: reason });
}

/**
 * Abort every in-flight browser op for a conversation. Called when the
 * conversation stream ends so dangling tool calls don't pin the LLM
 * forever.
 */
export function abortBrowserOps(
    conversationId: string,
    reason = "stream-aborted"
): void {
    const ids = pendingByConversation.get(conversationId);
    if (!ids) return;

    for (const id of ids) {
        const pending = pendingById.get(id);
        if (!pending) continue;
        pendingById.delete(id);
        // Resolve with ok=false rather than reject so the tool's `execute`
        // returns a clean failure payload to the LLM (mirrors how
        // questions abort with `cancelled: true`).
        pending.resolve({ ok: false, error: reason });
        notify(conversationId, {
            type: "resolved",
            requestId: id,
            ok: false,
            error: reason
        });
    }

    pendingByConversation.delete(conversationId);
}

export function clearConversationBrowserOpState(conversationId: string): void {
    abortBrowserOps(conversationId, "conversation-cleared");
    listenersByConversation.delete(conversationId);
}
