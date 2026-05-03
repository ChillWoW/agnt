import { createOpenAI } from "@ai-sdk/openai";
import {
    getCodexUserAgent,
    getInstallationId,
    getOriginator,
    getWindowId
} from "../../lib/codex-identity";
import { logger } from "../../lib/logger";
import { getStoredAccountId, getValidAccessToken } from "../auth/auth.service";

export interface CodexClientOptions {
    /**
     * Per-turn conversation id. Sent as the `session_id` header so the backend
     * can correlate every request that belongs to the same chat thread.
     * Mirrors `build_conversation_headers` in
     * `codex-rs/codex-api/src/requests/headers.rs`.
     */
    conversationId?: string;
    /**
     * Codex account to bill this request against. When omitted, falls back
     * to the currently-active account (see `getActiveAccountId`). Callers
     * that span multiple turns (the WS session, the streaming pipeline)
     * should snapshot this id at turn-start so a mid-stream account switch
     * doesn't corrupt headers/baseline state.
     */
    accountId?: string | null;
    /**
     * `true` when this client is being used to drive a subagent (e.g. the
     * `task` tool's spawned child). Adds the `x-openai-subagent: collab_spawn`
     * header used by Codex CLI to route subagent traffic.
     */
    isSubagent?: boolean;
    /**
     * The parent conversation id when `isSubagent` is true. Sent as
     * `x-codex-parent-thread-id` so the backend can attribute the subagent's
     * usage back to the parent thread.
     */
    parentConversationId?: string | null;
}

/**
 * Build the per-request identity/billing headers shared by every Codex
 * backend call. Returns `null` for any header whose value isn't currently
 * available; the caller filters those out before sending. Keeping the logic
 * here means both the HTTP transport (AI SDK) and the WebSocket transport
 * (codex-ws-session) can produce byte-identical headers.
 */
export async function buildCodexRequestHeaders(
    options: CodexClientOptions = {}
): Promise<Record<string, string>> {
    const accessToken = await getValidAccessToken(options.accountId);
    const accountId = await getStoredAccountId(options.accountId);

    const headers: Record<string, string> = {
        Authorization: `Bearer ${accessToken}`,
        originator: getOriginator(),
        "User-Agent": getCodexUserAgent(),
        "x-codex-installation-id": getInstallationId(),
        "x-codex-window-id": getWindowId()
    };

    if (accountId) {
        // The single most important billing header: without it the request
        // can fall into an unidentified, more expensive rate bucket.
        // (`BearerAuthProvider::add_auth_headers` in codex-rs.)
        headers["ChatGPT-Account-Id"] = accountId;
    } else {
        logger.warn(
            "[codex-client] No stored ChatGPT account id; requests will be sent without ChatGPT-Account-Id"
        );
    }

    if (options.conversationId) {
        headers.session_id = options.conversationId;
    }

    if (options.isSubagent) {
        headers["x-openai-subagent"] = "collab_spawn";
        if (options.parentConversationId) {
            headers["x-codex-parent-thread-id"] = options.parentConversationId;
        }
    }

    return headers;
}

/**
 * Build an AI SDK OpenAI provider pointed at the ChatGPT-auth Codex backend
 * (`https://chatgpt.com/backend-api/codex`), with all of the identity/billing
 * headers Codex CLI sends. Per-turn fields (`session_id`, subagent flags) are
 * baked in once at construction; for one-shot HTTP usage that's fine because
 * each call lives within a single turn.
 */
export async function createCodexClient(options: CodexClientOptions = {}) {
    logger.log("[codex-client] Creating OpenAI client with Codex backend", {
        conversationId: options.conversationId,
        isSubagent: options.isSubagent === true,
        hasParent: Boolean(options.parentConversationId)
    });

    const headers = await buildCodexRequestHeaders(options);

    return createOpenAI({
        apiKey: "placeholder",
        baseURL: "https://chatgpt.com/backend-api/codex",
        headers
    });
}
