/**
 * Per-conversation WebSocket session against the ChatGPT-auth Codex backend
 * (`wss://chatgpt.com/backend-api/codex/responses`).
 *
 * This is the heart of the token-parity work: instead of letting the AI SDK
 * re-upload the entire `input` array on every turn over HTTP/SSE, we hold a
 * single persistent WebSocket per conversation and, when the next request is
 * a strict extension of the previous one (instructions/tools/etc unchanged,
 * the new input prefix matches "previous input + items the server emitted"),
 * we send only the delta plus `previous_response_id`.
 *
 * The wire protocol mirrors `codex-rs`:
 *   - Outbound text frame: `{ "type": "response.create", ...ResponsesApiBody }`
 *     (see `ResponsesWsRequest` in
 *     `codex-rs/codex-api/src/common.rs:260` and the
 *     `ResponseCreateWsRequest` struct just above it).
 *   - Inbound text frames are JSON events with the same shape as HTTP SSE:
 *     `response.created`, `response.output_item.added`,
 *     `response.output_item.done`, `response.output_text.delta`,
 *     `response.completed`, etc.
 *   - Wrapped error events come back as `{ "type": "error", ... }`. They
 *     terminate the turn (see `parse_wrapped_websocket_error_event` in
 *     `codex-rs/codex-api/src/endpoint/responses_websocket.rs:467`).
 *   - Handshake header: `OpenAI-Beta: responses_websockets=2026-02-06`
 *     (`RESPONSES_WEBSOCKETS_V2_BETA_HEADER_VALUE`,
 *     `codex-rs/core/src/client.rs:138`).
 *   - The `x-codex-turn-state` cookie returned on the first response of a
 *     turn must be replayed on subsequent reconnects within the same turn for
 *     sticky routing (`codex-rs/core/src/client.rs:1569-1591`). Bun does not
 *     expose handshake response headers, so we can't capture it; we hold the
 *     same socket for the whole conversation, so this is rarely an issue.
 *
 * Output of `sendTurn` is a `ReadableStream<Uint8Array>` of SSE-formatted
 * bytes (`data: <json>\n\n` per event). That lets the AI SDK's existing
 * `EventSourceParserStream` + responses chunk schema parse the stream
 * exactly as if it had come from the HTTP `/responses` endpoint, so all of
 * our upstream code (tools, multi-step loop, abort handling, reasoning
 * encrypted_content replay) keeps working without changes.
 *
 * IMPORTANT: WebSocket listeners are attached **synchronously inside
 * `sendTurn`**, before `ws.send(envelope)`. The previous version attached
 * them inside the ReadableStream's `start()` callback, which runs lazily —
 * so early frames from the server could be lost in the gap between sending
 * the envelope and the consumer reading the first byte. Frames received
 * before the consumer attaches are buffered and flushed when `start()` runs.
 */

import { logger } from "../../lib/logger";
import { onActiveAccountChange } from "../auth/auth.service";
import { buildCodexRequestHeaders } from "./codex-client";

const WEBSOCKET_URL = "wss://chatgpt.com/backend-api/codex/responses";
const OPENAI_BETA_HEADER = "OpenAI-Beta";
const RESPONSES_WEBSOCKETS_V2 = "responses_websockets=2026-02-06";
const TURN_STATE_HEADER = "x-codex-turn-state";

const WIRE_LOG = process.env.AGNT_LOG_CODEX_WIRE === "1";

/**
 * If the server goes silent mid-turn for this many ms, error out instead of
 * hanging forever. codex-rs uses 60s; we match.
 */
const IDLE_TIMEOUT_MS = 60_000;

/**
 * The body shape the AI SDK posts to `/responses`. We don't tightly type it
 * because the SDK can add forward-compatible fields; we only inspect a few
 * known keys (`input`, `previous_response_id`, `stream`, `model`).
 */
export interface ResponsesApiBody {
    model: string;
    input: unknown[];
    instructions?: string;
    previous_response_id?: string | null;
    tools?: unknown[];
    tool_choice?: unknown;
    parallel_tool_calls?: boolean;
    reasoning?: unknown;
    store?: boolean;
    stream?: boolean;
    include?: string[];
    service_tier?: string;
    prompt_cache_key?: string;
    text?: unknown;
    metadata?: unknown;
    client_metadata?: Record<string, string>;
    [key: string]: unknown;
}

interface SessionOptions {
    conversationId: string;
    /**
     * Codex account this session is bound to. The Authorization /
     * ChatGPT-Account-Id headers used at handshake belong to this account,
     * so a session is NOT reusable across accounts. The session map keys on
     * `${conversationId}::${accountId}`; switching the active account drops
     * all open sessions via `onActiveAccountChange`.
     *
     * `null` when the user hasn't connected any account yet.
     */
    accountId: string | null;
    isSubagent?: boolean;
    parentConversationId?: string | null;
}

interface LastTurn {
    /** Full request body (with full input, before any incremental delta). */
    request: ResponsesApiBody;
    /** Items the server emitted via `response.output_item.done`. */
    itemsAdded: unknown[];
    /** `response.id` from the `response.completed` event (or earlier). */
    responseId: string;
}

/** Standard 1006-class transport-level error (handshake fail, blocked, etc). */
export class CodexWsHandshakeError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "CodexWsHandshakeError";
    }
}

/** Mid-turn error (socket dropped, malformed frame, server error event). */
export class CodexWsTurnError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "CodexWsTurnError";
    }
}

function deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a === null || b === null) return false;
    if (typeof a !== typeof b) return false;
    if (typeof a !== "object") return false;

    if (Array.isArray(a)) {
        if (!Array.isArray(b)) return false;
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i += 1) {
            if (!deepEqual(a[i], b[i])) return false;
        }
        return true;
    }
    if (Array.isArray(b)) return false;

    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const aKeys = Object.keys(aObj);
    const bKeys = Object.keys(bObj);
    if (aKeys.length !== bKeys.length) return false;
    for (const key of aKeys) {
        if (!Object.prototype.hasOwnProperty.call(bObj, key)) return false;
        if (!deepEqual(aObj[key], bObj[key])) return false;
    }
    return true;
}

/** Reason a getIncrementalItems comparison rejected an incremental delta. */
export type IncrementalRejection =
    | { kind: "non-input-fields-differ"; firstDifferingKey: string }
    | { kind: "input-shorter-than-baseline"; reqLen: number; baselineLen: number }
    | {
          kind: "input-prefix-mismatch";
          mismatchAt: number;
          baselineLen: number;
          serverType?: string;
          sdkType?: string;
          serverId?: string;
          sdkId?: string;
      }
    | { kind: "empty-delta"; len: number };

function describeRejection(reason: IncrementalRejection): string {
    switch (reason.kind) {
        case "non-input-fields-differ":
            return `non-input-fields-differ key=${reason.firstDifferingKey}`;
        case "input-shorter-than-baseline":
            return `input-shorter-than-baseline req=${reason.reqLen} baseline=${reason.baselineLen}`;
        case "input-prefix-mismatch": {
            const idDetail =
                reason.serverId !== undefined || reason.sdkId !== undefined
                    ? ` server=${reason.serverType ?? "?"}/${reason.serverId ?? "<no-id>"} sdk=${reason.sdkType ?? "?"}/${reason.sdkId ?? "<no-id>"}`
                    : "";
            return `input-prefix-mismatch at=${reason.mismatchAt} baseline=${reason.baselineLen}${idDetail}`;
        }
        case "empty-delta":
            return `empty-delta len=${reason.len}`;
    }
}

/**
 * Pull the `id` field off a Responses-API input/output item, if any.
 * Server-emitted items (function_call, message, reasoning, …) always carry
 * an opaque server id like `fc_…`, `msg_…`, `rs_…`. The AI SDK preserves
 * that id when it reconstructs the item on the next turn (via
 * `providerMetadata.openai.itemId` → `item.id`), so id+type is a
 * sufficient identity signal even though the rest of the body may differ
 * (e.g. the server adds `status: "completed"` that the SDK drops when
 * rebuilding `function_call` items — see
 * `convertToOpenAIResponsesInput` in `@ai-sdk/openai/dist/internal`).
 */
function getItemIdAndType(item: unknown): {
    id: string | null;
    type: string | null;
} {
    if (item === null || typeof item !== "object") {
        return { id: null, type: null };
    }
    const rec = item as Record<string, unknown>;
    const id = typeof rec.id === "string" ? rec.id : null;
    const type = typeof rec.type === "string" ? rec.type : null;
    return { id, type };
}

/**
 * Loose equality check used for verifying the incremental prefix.
 *
 * For server-emitted items (those with an `id`), we treat two items as
 * equal iff they share the same opaque server id AND the same `type`.
 * That's enough to convince ourselves the AI SDK is replaying the same
 * logical item — no need for the bodies to byte-match.
 *
 * For items without an id (user messages, system messages, tool results
 * created client-side, …), we fall back to strict `deepEqual`. Both
 * sides build those from the same source-of-truth (agnt's DB / the AI
 * SDK's own conversation state), so they should round-trip cleanly.
 */
function itemsLooselyEqual(
    serverItem: unknown,
    sdkItem: unknown
): { ok: true } | { ok: false } {
    const server = getItemIdAndType(serverItem);
    const sdk = getItemIdAndType(sdkItem);
    if (server.id !== null && sdk.id !== null) {
        if (server.id === sdk.id && server.type === sdk.type) {
            return { ok: true };
        }
        return { ok: false };
    }
    // No ids on at least one side — must match exactly.
    return deepEqual(serverItem, sdkItem) ? { ok: true } : { ok: false };
}

/**
 * Direct port of `get_incremental_items` from
 * `codex-rs/core/src/client.rs:934-971`.
 *
 * Returns the slice of `request.input` that comes after the baseline
 * (`last.request.input` + `last.itemsAdded`) iff every non-`input` field of
 * the request is unchanged AND the new input is a strict (non-empty)
 * extension of the baseline. Returns a `IncrementalRejection` when the
 * delta can't be reused — the rejection carries enough context for
 * `WIRE_LOG` to surface the exact reason without having to re-derive it.
 */
export function getIncrementalItems(
    request: ResponsesApiBody,
    last: LastTurn
):
    | { kind: "ok"; delta: unknown[] }
    | { kind: "reject"; reason: IncrementalRejection } {
    const prevWithoutInput: ResponsesApiBody = {
        ...last.request,
        input: []
    };
    const reqWithoutInput: ResponsesApiBody = { ...request, input: [] };
    if (!deepEqual(prevWithoutInput, reqWithoutInput)) {
        // Find the first key whose value differs — exposed via WIRE_LOG so
        // we can chase down spurious cache busts (e.g., a tool whose schema
        // got rebuilt non-deterministically between turns).
        const allKeys = new Set([
            ...Object.keys(prevWithoutInput),
            ...Object.keys(reqWithoutInput)
        ]);
        let firstDifferingKey = "<unknown>";
        for (const key of allKeys) {
            const a = (prevWithoutInput as Record<string, unknown>)[key];
            const b = (reqWithoutInput as Record<string, unknown>)[key];
            if (!deepEqual(a, b)) {
                firstDifferingKey = key;
                break;
            }
        }
        return {
            kind: "reject",
            reason: { kind: "non-input-fields-differ", firstDifferingKey }
        };
    }

    const baseline = [...last.request.input, ...last.itemsAdded];
    if (request.input.length < baseline.length) {
        return {
            kind: "reject",
            reason: {
                kind: "input-shorter-than-baseline",
                reqLen: request.input.length,
                baselineLen: baseline.length
            }
        };
    }
    for (let i = 0; i < baseline.length; i += 1) {
        // Loose equality: server-emitted items only need to match by
        // (id, type), since the AI SDK doesn't byte-perfectly round-trip
        // them. Items without ids fall back to strict equality.
        const result = itemsLooselyEqual(baseline[i], request.input[i]);
        if (!result.ok) {
            const server = getItemIdAndType(baseline[i]);
            const sdk = getItemIdAndType(request.input[i]);
            return {
                kind: "reject",
                reason: {
                    kind: "input-prefix-mismatch",
                    mismatchAt: i,
                    baselineLen: baseline.length,
                    serverType: server.type ?? undefined,
                    sdkType: sdk.type ?? undefined,
                    serverId: server.id ?? undefined,
                    sdkId: sdk.id ?? undefined
                }
            };
        }
    }
    if (request.input.length === baseline.length) {
        // The Rust impl allows empty deltas in the WS path
        // (`allow_empty_delta=true`), but in practice agnt always appends a
        // new user message or tool result before re-issuing, so an empty
        // delta means we're seeing a duplicate request. Force a full resend
        // rather than risk a no-op `response.create` that the server might
        // reject.
        return {
            kind: "reject",
            reason: { kind: "empty-delta", len: request.input.length }
        };
    }
    return { kind: "ok", delta: request.input.slice(baseline.length) };
}

/**
 * Per-conversation WebSocket session. Owns the socket, the incremental
 * baseline, and serializes turns through a tiny mutex so the AI SDK's
 * multi-step loop (assistant → tool → assistant) flows cleanly through one
 * connection.
 */
export class CodexWsSession {
    private socket: WebSocket | null = null;
    private connecting: Promise<WebSocket> | null = null;
    private last: LastTurn | null = null;
    private turnState: string | null = null;
    private busy = false;
    /**
     * Set to `true` when a handshake fails. The provider switches this
     * session to HTTP fallback for the remainder of its lifetime so we don't
     * keep retrying a broken WS path on every turn.
     */
    public wsDisabled = false;

    /** Monotonic id for the next turn — used in WIRE_LOG only. */
    private turnSeq = 0;

    constructor(public readonly opts: SessionOptions) {}

    /**
     * Send one model turn and return an SSE-formatted `ReadableStream` that
     * the AI SDK's `EventSourceParserStream` will happily parse.
     *
     * Will throw `CodexWsHandshakeError` if the underlying socket can't be
     * opened — caller falls back to HTTP and flips `wsDisabled` for the rest
     * of the session lifetime.
     */
    async sendTurn(
        body: ResponsesApiBody,
        signal?: AbortSignal | null
    ): Promise<ReadableStream<Uint8Array>> {
        if (this.busy) {
            // Should never happen: streamText is sequential per call. If it
            // does, surface as a clear error rather than corrupting state.
            throw new CodexWsTurnError(
                "codex-ws: previous turn still in flight"
            );
        }
        this.busy = true;

        let ws: WebSocket;
        try {
            ws = await this.ensureOpen();
        } catch (err) {
            this.busy = false;
            throw err;
        }

        const { wsRequest, baselineRequest, isIncremental, rejection } =
            this.prepareRequest(body);
        const envelope = JSON.stringify({
            type: "response.create",
            ...wsRequest
        });

        const turnId = ++this.turnSeq;
        if (WIRE_LOG) {
            // The "saved" figure is what the body WOULD have weighed had we
            // sent every input item on every turn. It's the headline
            // diagnostic for the token-parity work — a healthy 10-turn
            // dialog should show roughly linear savings growth.
            const fullEnvelopeBytes =
                JSON.stringify({
                    type: "response.create",
                    ...body
                }).length;
            const savedBytes = Math.max(0, fullEnvelopeBytes - envelope.length);
            const rejectionLabel = !isIncremental
                ? rejection === "no-baseline"
                    ? " reason=no-baseline"
                    : rejection
                      ? ` reason=${describeRejection(rejection)}`
                      : ""
                : "";
            logger.log(
                `[codex-ws] turn#${turnId} (${
                    isIncremental ? "incremental" : "full"
                }): conv=${this.opts.conversationId} ` +
                    `inputItems=${(wsRequest.input as unknown[]).length}/${body.input.length} ` +
                    `prevId=${wsRequest.previous_response_id ?? "null"} ` +
                    `bytes=${envelope.length} (full=${fullEnvelopeBytes}, saved=${savedBytes})` +
                    rejectionLabel
            );
        }

        // ---- Turn-local state held in this closure ----
        const session = this;
        const itemsAdded: unknown[] = [];
        let responseId = "";

        // Buffer for events that arrive before the consumer reads (i.e.,
        // before `start()` is invoked on the ReadableStream we return). The
        // AI SDK normally reads promptly, but we don't want to depend on a
        // microtask race: any frame that arrives while `streamController`
        // is null gets queued here and replayed inside `start`.
        const buffered: Uint8Array[] = [];
        let streamController: ReadableStreamDefaultController<Uint8Array> | null =
            null;

        let terminated = false;
        let cleanedUp = false;
        let pendingError: unknown = null;
        let pendingClose = false;

        // First-frame gate. We don't return the ReadableStream from
        // `sendTurn` until either the server has emitted at least one frame
        // (so we know the WS turn is healthy) or a terminal error fired (so
        // the caller can transparently fall back to HTTP). This is what
        // turns "socket closed mid-turn before any data" — historically a
        // hard user-visible error — into a recoverable HTTP fallback.
        //
        // The Bun WebSocket sometimes hands us a socket whose underlying
        // TCP connection has already been silently torn down by the server
        // / a NAT box. We don't notice until `ws.send` returns and the
        // close event fires shortly after. Without this gate, the AI SDK
        // has already received the Response object and reads the error off
        // the body stream, which it can't recover from.
        let firstFrameSettled = false;
        let resolveFirstFrame: (() => void) | null = null;
        let rejectFirstFrame: ((err: unknown) => void) | null = null;
        const firstFramePromise = new Promise<void>((resolve, reject) => {
            resolveFirstFrame = resolve;
            rejectFirstFrame = reject;
        });
        const settleFirstFrameOk = () => {
            if (firstFrameSettled) return;
            firstFrameSettled = true;
            resolveFirstFrame?.();
            resolveFirstFrame = null;
            rejectFirstFrame = null;
        };
        const settleFirstFrameErr = (err: unknown) => {
            if (firstFrameSettled) return;
            firstFrameSettled = true;
            rejectFirstFrame?.(err);
            resolveFirstFrame = null;
            rejectFirstFrame = null;
        };

        const enqueue = (chunk: Uint8Array): boolean => {
            if (terminated) return false;
            // First successful chunk → the WS turn is producing data, so
            // unblock `sendTurn`'s first-frame await (and any later error
            // surfaces through the stream as usual).
            settleFirstFrameOk();
            if (streamController) {
                try {
                    streamController.enqueue(chunk);
                    return true;
                } catch {
                    cleanup();
                    return false;
                }
            }
            buffered.push(chunk);
            return true;
        };

        const closeStream = () => {
            if (terminated) return;
            terminated = true;
            // A clean close means the turn produced data and finished —
            // make sure first-frame waiters wake up rather than hang.
            settleFirstFrameOk();
            if (streamController) {
                try {
                    streamController.close();
                } catch {
                    // already closed
                }
            } else {
                pendingClose = true;
            }
            cleanup();
        };

        const errorStream = (err: unknown) => {
            if (terminated) return;
            terminated = true;
            // If we haven't returned the stream yet, surface the error to
            // the `await firstFramePromise` site so the caller can fall
            // back to HTTP. Otherwise this is a no-op (the consumer will
            // see the error through `streamController.error`).
            settleFirstFrameErr(err);
            if (streamController) {
                try {
                    streamController.error(err);
                } catch {
                    // already errored / closed
                }
            } else {
                pendingError = err;
            }
            cleanup();
        };

        // Idle-timeout watchdog: any inbound message resets it; if it fires
        // we error the turn so the AI SDK doesn't sit on an indefinitely
        // hung stream.
        let idleTimer: ReturnType<typeof setTimeout> | null = null;
        const armIdleTimer = () => {
            if (idleTimer !== null) clearTimeout(idleTimer);
            idleTimer = setTimeout(() => {
                if (WIRE_LOG) {
                    logger.warn(
                        `[codex-ws] turn#${turnId} idle timeout after ${IDLE_TIMEOUT_MS}ms; conv=${this.opts.conversationId}`
                    );
                }
                session.last = null;
                session.dropSocket("idle timeout");
                errorStream(
                    new CodexWsTurnError(
                        `codex-ws: idle timeout after ${IDLE_TIMEOUT_MS}ms`
                    )
                );
            }, IDLE_TIMEOUT_MS);
        };

        let abortHandler: (() => void) | null = null;

        const cleanup = () => {
            if (cleanedUp) return;
            cleanedUp = true;
            if (idleTimer !== null) {
                clearTimeout(idleTimer);
                idleTimer = null;
            }
            ws.removeEventListener("message", onMessage as EventListener);
            ws.removeEventListener("error", onError as EventListener);
            ws.removeEventListener("close", onClose as EventListener);
            if (signal && abortHandler) {
                signal.removeEventListener("abort", abortHandler);
            }
            session.busy = false;
        };

        const encoder = new TextEncoder();

        const onMessage = (event: MessageEvent) => {
            const text =
                typeof event.data === "string"
                    ? event.data
                    : event.data instanceof ArrayBuffer
                      ? new TextDecoder().decode(event.data)
                      : "";
            if (text.length === 0) return;

            armIdleTimer();

            let parsed: Record<string, unknown> | null = null;
            try {
                const value = JSON.parse(text);
                if (value && typeof value === "object") {
                    parsed = value as Record<string, unknown>;
                }
            } catch {
                // Malformed frame — drop it; it can't be a terminal event so
                // letting the SSE parser see nothing is safer than emitting
                // garbage.
                if (WIRE_LOG) {
                    logger.warn(
                        `[codex-ws] turn#${turnId} dropped non-JSON frame: ${text.slice(0, 120)}`
                    );
                }
                return;
            }
            if (parsed === null) return;

            const type = parsed.type;
            if (typeof type !== "string") return;

            // Wrapped error events terminate the turn. codex-rs treats any
            // frame with `type: "error"` as fatal
            // (parse_wrapped_websocket_error_event,
            // codex-rs/codex-api/src/endpoint/responses_websocket.rs:467).
            // If we silently drop it, we'd hang waiting for a
            // response.completed that will never come.
            if (type === "error") {
                const errInfo = parsed.error as
                    | { code?: unknown; message?: unknown }
                    | undefined;
                const errMessage =
                    typeof errInfo?.message === "string"
                        ? errInfo.message
                        : `codex-ws: server error event (status=${parsed.status ?? parsed.status_code ?? "?"})`;
                if (WIRE_LOG) {
                    logger.warn(
                        `[codex-ws] turn#${turnId} server error event: ${text.slice(0, 240)}`
                    );
                }
                session.last = null;
                // Error events from the server do not necessarily mean the
                // socket itself is dead, but we can't safely reuse the
                // baseline. Drop the socket to force a clean reconnect on
                // the next turn.
                session.dropSocket("error event");
                errorStream(new CodexWsTurnError(errMessage));
                return;
            }

            // codex-rs forwards a few non-Responses events over the same
            // socket (`codex.rate_limits`, telemetry pings). The AI SDK
            // chunk schema only knows `response.*`; let anything else
            // through and the schema's fallback would log it. Silently
            // ignoring is fine.
            if (!type.startsWith("response.")) {
                return;
            }

            if (type === "response.created" && responseId.length === 0) {
                const resp = parsed.response as { id?: unknown } | undefined;
                if (resp && typeof resp.id === "string") {
                    responseId = resp.id;
                }
            }
            if (type === "response.output_item.done") {
                const item = parsed.item;
                if (item !== undefined) {
                    itemsAdded.push(item);
                }
            }
            if (type === "response.completed") {
                const resp = parsed.response as { id?: unknown } | undefined;
                if (resp && typeof resp.id === "string") {
                    responseId = resp.id;
                }
            }

            if (!enqueue(encoder.encode(`data: ${text}\n\n`))) {
                return;
            }

            if (
                type === "response.completed" ||
                type === "response.failed" ||
                type === "response.incomplete"
            ) {
                if (
                    type === "response.completed" &&
                    responseId.length > 0
                ) {
                    session.last = {
                        request: baselineRequest,
                        itemsAdded,
                        responseId
                    };
                } else {
                    // Don't trust an incomplete/failed turn's items as a
                    // baseline — the server may not have actually persisted
                    // them, so a future incremental request keyed off it
                    // would be wrong.
                    session.last = null;
                }
                if (WIRE_LOG) {
                    const baselineState =
                        session.last !== null
                            ? `baselineSaved=true(input=${session.last.request.input.length}+items=${session.last.itemsAdded.length})`
                            : `baselineSaved=false`;
                    logger.log(
                        `[codex-ws] turn#${turnId} terminal=${type} responseId=${responseId || "<none>"} itemsAdded=${itemsAdded.length} ${baselineState}`
                    );
                }
                closeStream();
            }
        };

        const onError = (_event: Event) => {
            if (WIRE_LOG) {
                logger.warn(
                    `[codex-ws] turn#${turnId} socket error event; conv=${this.opts.conversationId}`
                );
            }
            session.last = null;
            session.dropSocket("error event");
            errorStream(new CodexWsTurnError("codex-ws: socket error"));
        };

        const onClose = (_event: Event) => {
            if (terminated) return;
            // Differentiate "closed before any frame arrived" (recoverable
            // via HTTP fallback) from "closed mid-stream after we'd already
            // started forwarding deltas" (unrecoverable, surfaces to the
            // user). The phase=before vs phase=after-frame token also lets
            // us spot a stuck-on-handshake server quickly in the log.
            const phase = firstFrameSettled ? "after-frame" : "before-frame";
            logger.warn(
                `[codex-ws] turn#${turnId} socket closed mid-turn (phase=${phase}); ` +
                    `conv=${this.opts.conversationId} responseId=${responseId || "<none>"}`
            );
            session.last = null;
            session.dropSocket("close before completion");
            errorStream(
                new CodexWsTurnError(
                    `codex-ws: socket closed mid-turn (${phase})`
                )
            );
        };

        if (signal) {
            if (signal.aborted) {
                cleanup();
                // Caller-managed abort: surface the same way `fetch` would,
                // by returning a stream that errors on first read.
                return new ReadableStream<Uint8Array>({
                    start(controller) {
                        controller.error(
                            signal.reason instanceof Error
                                ? signal.reason
                                : new Error("aborted")
                        );
                    }
                });
            }
            abortHandler = () => {
                if (WIRE_LOG) {
                    logger.log(
                        `[codex-ws] turn#${turnId} aborted by caller; conv=${this.opts.conversationId}`
                    );
                }
                // Abort wipes our incremental baseline because the server
                // may not have emitted `response.completed` and our
                // `itemsAdded` is therefore incomplete.
                session.last = null;
                errorStream(
                    signal.reason instanceof Error
                        ? signal.reason
                        : new Error("aborted")
                );
            };
            signal.addEventListener("abort", abortHandler, { once: true });
        }

        // Attach listeners FIRST so we don't lose any frame the server sends
        // between `ws.send` returning and the consumer reading from the
        // stream. Browser/Node WebSocket implementations dispatch
        // `MessageEvent`s to whatever listeners are attached at dispatch
        // time; a missing listener means a dropped frame.
        ws.addEventListener("message", onMessage as EventListener);
        ws.addEventListener("error", onError as EventListener);
        ws.addEventListener("close", onClose as EventListener);
        armIdleTimer();

        try {
            ws.send(envelope);
        } catch (err) {
            const sendErr = new CodexWsTurnError(
                `codex-ws: send failed: ${(err as Error).message}`
            );
            // Settle the first-frame promise so it doesn't dangle as an
            // unhandled rejection if anything observes it later.
            settleFirstFrameErr(sendErr);
            cleanup();
            session.last = null;
            session.dropSocket("send failed");
            throw sendErr;
        }

        // Block until either the first frame arrives (the WS turn is
        // healthy → return the stream) or a terminal error fires (→ throw
        // so the provider's fetch wrapper can fall back to HTTP). This is
        // the recovery path for "socket closed mid-turn before any data",
        // which used to surface to the user as an unrecoverable stream
        // error and lose the entire turn.
        try {
            await firstFramePromise;
        } catch (err) {
            // `cleanup()` already ran inside `errorStream`; just propagate.
            // We deliberately don't wrap non-CodexWs errors (e.g. abort
            // reasons) so the caller's existing logic still distinguishes
            // them — only `CodexWsTurnError` triggers HTTP fallback.
            throw err;
        }

        return new ReadableStream<Uint8Array>({
            start(controller) {
                streamController = controller;

                // Replay anything the server pushed before the consumer was
                // ready to read.
                for (const chunk of buffered) {
                    try {
                        controller.enqueue(chunk);
                    } catch {
                        cleanup();
                        return;
                    }
                }
                buffered.length = 0;

                // If the turn already terminated (error / close / completed
                // before start was invoked), propagate that now.
                if (pendingError !== null) {
                    try {
                        controller.error(pendingError);
                    } catch {
                        // already errored
                    }
                    pendingError = null;
                    return;
                }
                if (pendingClose) {
                    try {
                        controller.close();
                    } catch {
                        // already closed
                    }
                    pendingClose = false;
                }
            },
            cancel(reason?: unknown) {
                // Caller (AI SDK) cancelled the stream.
                //
                // If the turn already terminated (response.completed,
                // error, abort) before cancel ran, this is a no-op cleanup
                // path — listeners are gone, `busy` is already cleared,
                // socket is in whatever state the prior path left it in
                // (kept alive on completed, dropped on error). Don't drop
                // it again: that would unnecessarily kill the connection
                // between healthy turns. Critically, do NOT wipe
                // `session.last`: the AI SDK in v3 cancels the previous
                // step's stream when starting the next step in a multi-step
                // tool loop, and clearing the incremental baseline here
                // would force every subsequent turn to upload the full
                // history (defeating the entire token-parity optimization).
                //
                // If the turn was STILL in flight when cancel fired
                // (consumer bailed out mid-stream), we must drop the
                // socket. The server is still generating tokens, those
                // frames will arrive in our OS buffer, and if a new turn
                // races in fast enough to re-attach listeners, those late
                // frames would contaminate the new turn. We also wipe
                // `session.last` because mid-flight `itemsAdded` is
                // incomplete and would produce an incorrect baseline.
                const wasInFlight = !terminated;
                if (WIRE_LOG) {
                    const why =
                        reason instanceof Error
                            ? reason.message
                            : reason !== undefined
                              ? String(reason)
                              : "consumer cancel";
                    logger.log(
                        `[codex-ws] turn#${turnId} stream cancelled (inFlight=${wasInFlight}): ${why}; ` +
                            `conv=${session.opts.conversationId}`
                    );
                }
                terminated = true;
                cleanup();
                if (wasInFlight) {
                    session.last = null;
                    session.dropSocket("stream cancelled mid-turn");
                }
            }
        });
    }

    close(): void {
        this.last = null;
        this.turnState = null;
        this.busy = false;
        this.dropSocket("explicit close");
    }

    private dropSocket(reason: string): void {
        const ws = this.socket;
        if (ws === null) return;
        this.socket = null;
        try {
            if (
                ws.readyState === WebSocket.OPEN ||
                ws.readyState === WebSocket.CONNECTING
            ) {
                ws.close(1000, reason);
            }
        } catch {
            // ignore
        }
    }

    private async ensureOpen(): Promise<WebSocket> {
        const existing = this.socket;
        if (existing && existing.readyState === WebSocket.OPEN) {
            return existing;
        }
        if (this.connecting) {
            return this.connecting;
        }
        this.connecting = this.connect().finally(() => {
            this.connecting = null;
        });
        return this.connecting;
    }

    private async connect(): Promise<WebSocket> {
        const headers = await buildCodexRequestHeaders({
            conversationId: this.opts.conversationId,
            accountId: this.opts.accountId,
            isSubagent: this.opts.isSubagent,
            parentConversationId: this.opts.parentConversationId
        });
        headers[OPENAI_BETA_HEADER] = RESPONSES_WEBSOCKETS_V2;
        if (this.turnState !== null) {
            headers[TURN_STATE_HEADER] = this.turnState;
        }

        if (WIRE_LOG) {
            logger.log(
                `[codex-ws] opening socket: conv=${this.opts.conversationId} ` +
                    `account=${this.opts.accountId ?? "<unset>"} ` +
                    `isSubagent=${this.opts.isSubagent === true} ` +
                    `parent=${this.opts.parentConversationId ?? "null"}`
            );
        }

        // Bun extends the standard `WebSocket` constructor with a second
        // options arg so we can attach Authorization and friends. See
        // https://bun.sh/reference/bun/WebSocketOptions.
        const ws = new WebSocket(WEBSOCKET_URL, {
            headers
        } as unknown as string[]);

        return new Promise<WebSocket>((resolve, reject) => {
            const onOpen = () => {
                ws.removeEventListener("open", onOpen);
                ws.removeEventListener("error", onErrorDuringOpen);
                this.socket = ws;
                ws.addEventListener("close", () => {
                    if (this.socket === ws) {
                        if (WIRE_LOG) {
                            logger.log(
                                `[codex-ws] socket closed; conv=${this.opts.conversationId}`
                            );
                        }
                        this.socket = null;
                        // Discard incremental baseline: a brand-new socket
                        // can't safely reuse `previous_response_id` from a
                        // previous connection (server affinity may differ).
                        this.last = null;
                    }
                });
                resolve(ws);
            };
            const onErrorDuringOpen = (_event: Event) => {
                ws.removeEventListener("open", onOpen);
                ws.removeEventListener("error", onErrorDuringOpen);
                reject(
                    new CodexWsHandshakeError(
                        "codex-ws: handshake failed (network blocked, beta gate off, or backend rejection)"
                    )
                );
            };
            ws.addEventListener("open", onOpen);
            ws.addEventListener("error", onErrorDuringOpen);
        });
    }

    private prepareRequest(body: ResponsesApiBody): {
        wsRequest: ResponsesApiBody;
        baselineRequest: ResponsesApiBody;
        isIncremental: boolean;
        rejection?: IncrementalRejection | "no-baseline";
    } {
        if (this.last === null || this.last.responseId.length === 0) {
            return {
                wsRequest: body,
                baselineRequest: body,
                isIncremental: false,
                rejection: "no-baseline"
            };
        }
        const incremental = getIncrementalItems(body, this.last);
        if (incremental.kind === "reject") {
            return {
                wsRequest: body,
                baselineRequest: body,
                isIncremental: false,
                rejection: incremental.reason
            };
        }
        return {
            wsRequest: {
                ...body,
                input: incremental.delta,
                previous_response_id: this.last.responseId
            },
            baselineRequest: body,
            isIncremental: true
        };
    }
}

const sessions = new Map<string, CodexWsSession>();

function sessionKey(opts: Pick<SessionOptions, "conversationId" | "accountId">): string {
    return `${opts.conversationId}::${opts.accountId ?? "<unset>"}`;
}

/**
 * Get-or-create the session for a (conversation, account) pair. Subagents
 * are keyed by their own conversation id, so they get their own socket and
 * don't share incremental state with the parent.
 *
 * Account is part of the key because each session bakes the Authorization /
 * ChatGPT-Account-Id headers at WS-handshake time. When the user switches
 * the active account, `auth.service` fires `onActiveAccountChange` which
 * drops every session here so the next turn opens a fresh socket under the
 * new credentials.
 */
export function getOrCreateSession(opts: SessionOptions): CodexWsSession {
    const key = sessionKey(opts);
    const existing = sessions.get(key);
    if (existing) return existing;
    const created = new CodexWsSession(opts);
    sessions.set(key, created);
    return created;
}

export function closeSession(conversationId: string): void {
    // Close every session for this conversation regardless of accountId.
    const prefix = `${conversationId}::`;
    for (const [key, session] of sessions.entries()) {
        if (!key.startsWith(prefix)) continue;
        session.close();
        sessions.delete(key);
    }
}

export function closeAllSessions(): void {
    for (const session of sessions.values()) {
        session.close();
    }
    sessions.clear();
}

// When the active account changes (or any account is removed), drop all WS
// sessions so the next turn re-handshakes under the fresh credentials.
onActiveAccountChange(() => {
    if (sessions.size === 0) return;
    logger.log(
        `[codex-ws] active account changed; closing ${sessions.size} session(s)`
    );
    closeAllSessions();
});
