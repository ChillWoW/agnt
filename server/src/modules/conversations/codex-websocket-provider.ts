/**
 * Custom-fetch wrapper that routes the AI SDK's POST `/responses` calls
 * through a per-conversation WebSocket session (`codex-ws-session.ts`)
 * instead of HTTP/SSE.
 *
 * The wrapper is invisible to the rest of the app: callers still build a
 * normal AI SDK `LanguageModelV3` with `provider.responses(modelName)`, and
 * `streamText` continues to drive it the same way it does for plain HTTP.
 * The only difference is that, when a request hits our `fetch`, we either
 *   - take the request body, send it over the persistent WebSocket, and
 *     return a synthetic `Response` whose body is an SSE-formatted stream
 *     of the WS events (so the AI SDK's `EventSourceParserStream` parses it
 *     unchanged), or
 *   - fall back to the real `fetch` if WS is disabled / the path doesn't
 *     match (e.g., the SDK posts to a sub-endpoint we don't intercept).
 *
 * On the very first `/responses` call for a conversation we attempt the WS
 * handshake; if it fails (older backend, network blocks WSS, beta gate off)
 * we set `session.wsDisabled = true` and stay on HTTP for the rest of the
 * conversation's lifetime, logging a single warning. This matches the
 * fallback strategy in the plan.
 */

import { createOpenAI } from "@ai-sdk/openai";

import { logger } from "../../lib/logger";
import { buildCodexRequestHeaders, type CodexClientOptions } from "./codex-client";
import {
    CodexWsHandshakeError,
    CodexWsTurnError,
    getOrCreateSession,
    type CodexWsSession,
    type ResponsesApiBody
} from "./codex-ws-session";

const RESPONSES_PATH_SUFFIX = "/responses";
const HTTP_BASE_URL = "https://chatgpt.com/backend-api/codex";

interface CodexWsModelOptions extends CodexClientOptions {
    conversationId: string;
    /**
     * Active Codex account snapshotted at turn-start. Drives both the WS
     * session key (so a mid-stream account switch doesn't reuse a socket
     * authenticated for a different account) and the HTTP fallback headers.
     * `null` is allowed for the rare "not connected yet" path; downstream
     * `buildCodexRequestHeaders` will throw a clear error.
     */
    accountId: string | null;
}

function urlMatchesResponses(input: string): boolean {
    // The ai-sdk responses model posts to `${baseURL}/responses`. We don't
    // want to intercept anything else (the SDK has other endpoints under the
    // same base URL — files, retrieve, etc.).
    let pathname: string;
    try {
        pathname = new URL(input).pathname;
    } catch {
        return false;
    }
    return pathname.endsWith(RESPONSES_PATH_SUFFIX);
}

function asResponsesApiBody(value: unknown): ResponsesApiBody | null {
    if (value === null || typeof value !== "object") return null;
    const candidate = value as Partial<ResponsesApiBody>;
    if (typeof candidate.model !== "string") return null;
    if (!Array.isArray(candidate.input)) return null;
    return candidate as ResponsesApiBody;
}

/**
 * Decode an `init.body` (which may be a string, Buffer, Uint8Array, or
 * ReadableStream) into a JS object. Returns `null` if we cannot interpret
 * it as a JSON `ResponsesApiBody`.
 */
async function decodeRequestBody(
    body: unknown
): Promise<ResponsesApiBody | null> {
    if (body === null || body === undefined) return null;
    let text: string;
    if (typeof body === "string") {
        text = body;
    } else if (body instanceof Uint8Array) {
        text = new TextDecoder().decode(body);
    } else if (body instanceof ArrayBuffer) {
        text = new TextDecoder().decode(body);
    } else if (typeof Blob !== "undefined" && body instanceof Blob) {
        text = await body.text();
    } else if (
        typeof ReadableStream !== "undefined" &&
        body instanceof ReadableStream
    ) {
        // The AI SDK uses JSON strings, never streams. Accept defensively.
        const reader = (body as ReadableStream<Uint8Array>).getReader();
        const chunks: Uint8Array[] = [];
        // eslint-disable-next-line no-constant-condition
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value instanceof Uint8Array) chunks.push(value);
        }
        const total = chunks.reduce((n, c) => n + c.byteLength, 0);
        const merged = new Uint8Array(total);
        let offset = 0;
        for (const c of chunks) {
            merged.set(c, offset);
            offset += c.byteLength;
        }
        text = new TextDecoder().decode(merged);
    } else {
        return null;
    }
    try {
        return asResponsesApiBody(JSON.parse(text));
    } catch {
        return null;
    }
}

/**
 * Build a `Response` with an SSE body. Status/headers mirror what the real
 * `chatgpt.com/backend-api/codex/responses` endpoint returns for streaming
 * responses, so the AI SDK's response handler is happy.
 */
function makeSseResponse(stream: ReadableStream<Uint8Array>): Response {
    return new Response(stream, {
        status: 200,
        headers: {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
            connection: "keep-alive"
        }
    });
}

async function runOverWebSocket(
    session: CodexWsSession,
    body: ResponsesApiBody,
    signal: AbortSignal | null | undefined
): Promise<Response> {
    const stream = await session.sendTurn(body, signal);
    return makeSseResponse(stream);
}

/**
 * Build a `LanguageModelV3` for the given conversation that streams over a
 * WebSocket. The returned model is a drop-in replacement for
 * `codex.responses(modelName)` — `streamText` does not know it's a different
 * transport.
 *
 * Phase-1 identity headers (Authorization, ChatGPT-Account-Id, originator,
 * User-Agent, x-codex-installation-id, x-codex-window-id, session_id, and
 * subagent flags when applicable) are baked into both the WS handshake (via
 * `buildCodexRequestHeaders`) and the fallback HTTP `fetch` (via the
 * provider headers below). Both paths therefore produce byte-identical
 * billing attribution.
 */
export async function createCodexWsModel(options: CodexWsModelOptions & { modelName: string }): Promise<ReturnType<ReturnType<typeof createOpenAI>["responses"]>> {
    const session = getOrCreateSession({
        conversationId: options.conversationId,
        accountId: options.accountId,
        isSubagent: options.isSubagent,
        parentConversationId: options.parentConversationId
    });

    // Phase-1 headers are reused for the HTTP fallback path. The WS path
    // builds its own headers fresh inside `connect()` so a token refresh
    // between turns is picked up automatically. Both paths resolve the same
    // snapshotted accountId so billing attribution is identical.
    const httpHeaders = await buildCodexRequestHeaders({
        conversationId: options.conversationId,
        accountId: options.accountId,
        isSubagent: options.isSubagent,
        parentConversationId: options.parentConversationId
    });

    // Permissive shape: `globalThis.fetch` resolves to slightly different
    // typings under Bun vs Node DOM lib; we just need (input, init) =>
    // Promise<Response>. Cast at the boundary into `createOpenAI`.
    type FetchInput = Parameters<typeof globalThis.fetch>[0];
    type FetchInit = Parameters<typeof globalThis.fetch>[1];
    type FetchLike = (
        input: FetchInput,
        init?: FetchInit
    ) => Promise<Response>;

    const fallbackFetch: FetchLike = (input, init) =>
        globalThis.fetch(input, init);

    const wsAwareFetch: FetchLike = async (input, init) => {
        const url =
            typeof input === "string"
                ? input
                : input instanceof URL
                  ? input.toString()
                  : input instanceof Request
                    ? input.url
                    : "";

        const method =
            (init?.method ??
                (input instanceof Request ? input.method : "GET")) ||
            "GET";

        if (
            session.wsDisabled ||
            method.toUpperCase() !== "POST" ||
            !urlMatchesResponses(url)
        ) {
            return fallbackFetch(input, init);
        }

        // Decode the body so we can both (a) feed it to the WS session and
        // (b) compare it against the previous turn for incremental diffing.
        const bodyToSend: unknown =
            init?.body ?? (input instanceof Request ? input.body : undefined);
        const parsed = await decodeRequestBody(bodyToSend);
        if (parsed === null) {
            // Couldn't parse — let HTTP handle it.
            return fallbackFetch(input, init);
        }

        const signal =
            (init?.signal as AbortSignal | null | undefined) ??
            (input instanceof Request ? input.signal : null);

        // Helper to retry the same turn over HTTP. We rebuild `init.body`
        // from the already-decoded JSON because the original may have been
        // consumed (e.g. if it was a `ReadableStream`); for the typical
        // string/Buffer case this is a no-op but it's strictly safer.
        const fallbackOverHttp = (): Promise<Response> => {
            const fallbackInit: RequestInit = {
                ...(init ?? {}),
                body: JSON.stringify(parsed)
            };
            return fallbackFetch(input, fallbackInit);
        };

        try {
            return await runOverWebSocket(session, parsed, signal);
        } catch (err) {
            if (err instanceof CodexWsHandshakeError) {
                if (!session.wsDisabled) {
                    session.wsDisabled = true;
                    logger.warn(
                        `[codex-ws] handshake failed for conversation ${options.conversationId}; ` +
                            `falling back to HTTP for the rest of this conversation`,
                        err
                    );
                }
                return fallbackOverHttp();
            }
            if (err instanceof CodexWsTurnError) {
                // The WS turn died before producing a single frame
                // (`sendTurn` now blocks on a first-frame gate). The
                // server hasn't streamed any data to the AI SDK yet, so
                // we can transparently retry this exact turn over HTTP
                // and the user never sees an error. The session's
                // incremental baseline was already cleared inside
                // `errorStream`, so the HTTP request will upload the
                // full input — correct, just slightly heavier this turn.
                //
                // Note: WS is *not* permanently disabled. Mid-turn close
                // is often transient (stale TCP connection, NAT timeout,
                // server-side load shedding); the next turn re-opens a
                // fresh socket via `ensureOpen` and usually succeeds.
                logger.warn(
                    `[codex-ws] turn failed before first frame for conversation ${options.conversationId}; ` +
                        `falling back to HTTP for this turn`,
                    err
                );
                return fallbackOverHttp();
            }
            throw err;
        }
    };

    const provider = createOpenAI({
        apiKey: "placeholder",
        baseURL: HTTP_BASE_URL,
        headers: httpHeaders,
        // The AI SDK types `fetch` as `typeof globalThis.fetch` which carries
        // the `preconnect` static under Bun; we only invoke it as a plain
        // function so the cast is safe.
        fetch: wsAwareFetch as unknown as typeof globalThis.fetch
    });
    return provider.responses(options.modelName);
}
