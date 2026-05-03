import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { getHomeDir, getHomePath } from "../../lib/homedir";
import { logger } from "../../lib/logger";
import {
    authAccountSchema,
    authStateSchema,
    legacyStoredCodexAuthSchema,
    storedAuthFileSchema,
    storedCodexAccountSchema,
    type AuthAccount,
    type AuthConnectStartResponse,
    type AuthOauthSessionStatus,
    type AuthState,
    type StoredAuthFile,
    type StoredCodexAccount
} from "./auth.types";

const AUTH_FILE_NAME = "auth.json";
const AUTH_FILE_PATH = getHomePath(AUTH_FILE_NAME);
const OAUTH_SESSION_TTL_MS = 10 * 60 * 1000;
const CODEX_CALLBACK_PORT = 1455;
const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const CODEX_ISSUER = "https://auth.openai.com";
const CODEX_ORIGINATOR = "codex_cli_rs";

type PendingOauthSession = {
    sessionId: string;
    state: string;
    codeVerifier: string;
    redirectUri: string;
    status: AuthOauthSessionStatus;
    createdAt: number;
};

const pendingOauthSessions = new Map<string, PendingOauthSession>();
const pendingOauthSessionsByState = new Map<string, string>();
let oauthCallbackServer: ReturnType<typeof createServer> | null = null;
let oauthCallbackServerSessionId: string | null = null;

/**
 * Other modules can register a hook that fires whenever the active account
 * changes (or any account is removed). Used by codex-ws-session.ts to drop
 * its open WebSocket pool so the next turn handshakes with the fresh token.
 *
 * Implemented as a registry rather than a direct import so we don't create
 * a circular dependency (auth.service ← codex-client ← codex-ws-session).
 */
type AccountChangeListener = () => void | Promise<void>;
const accountChangeListeners = new Set<AccountChangeListener>();

export function onActiveAccountChange(listener: AccountChangeListener): () => void {
    accountChangeListeners.add(listener);
    return () => accountChangeListeners.delete(listener);
}

async function notifyAccountChange() {
    for (const listener of accountChangeListeners) {
        try {
            await listener();
        } catch (error) {
            logger.warn("[auth] Active-account change listener threw:", error);
        }
    }
}

function nowIso() {
    return new Date().toISOString();
}

function toBase64Url(bytes: Uint8Array) {
    return Buffer.from(bytes)
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
}

function createRandomToken(byteLength: number) {
    const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
    return toBase64Url(bytes);
}

async function createCodeChallenge(codeVerifier: string) {
    const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(codeVerifier)
    );

    return toBase64Url(new Uint8Array(digest));
}

async function ensureAuthFile() {
    await mkdir(getHomeDir(), { recursive: true });

    try {
        await readFile(AUTH_FILE_PATH, "utf8");
    } catch {
        logger.log("[auth] Creating new auth file at", AUTH_FILE_PATH);
        const empty: StoredAuthFile = {
            version: 2,
            activeAccountId: null,
            accounts: []
        };
        await writeFile(AUTH_FILE_PATH, JSON.stringify(empty, null, 4), "utf8");
    }
}

function emptyAuthFile(): StoredAuthFile {
    return { version: 2, activeAccountId: null, accounts: [] };
}

function serializeAuthFile(file: StoredAuthFile) {
    return JSON.stringify(file, null, 4);
}

function toAuthAccount(account: StoredCodexAccount): AuthAccount {
    return authAccountSchema.parse({
        accountId: account.accountId,
        email: account.email ?? null,
        name: account.name ?? null,
        label: account.label ?? null,
        expires: account.expires ?? null,
        connectedAt: account.connectedAt,
        updatedAt: account.updatedAt
    });
}

function toAuthState(file: StoredAuthFile): AuthState {
    return authStateSchema.parse({
        accounts: file.accounts.map(toAuthAccount),
        activeAccountId:
            file.activeAccountId &&
            file.accounts.some((a) => a.accountId === file.activeAccountId)
                ? file.activeAccountId
                : (file.accounts[0]?.accountId ?? null)
    });
}

/**
 * Read `~/.agnt/auth.json` and return a normalized `StoredAuthFile`. Handles
 *   - the empty `{}` placeholder
 *   - the legacy v1 single-blob shape (returns migrated in-memory; persisted
 *     opportunistically on the next legitimate write)
 *   - the new v2 multi-account shape
 *   - any unparseable garbage (returns empty in-memory)
 *
 * CRITICAL: this function NEVER writes to `auth.json` from a failure path.
 * Earlier versions overwrote the file with the empty placeholder on
 * `readFile` / `JSON.parse` / unrecognized-shape errors, which could destroy
 * the user's accounts when:
 *   1. A concurrent reader collided with `writeAuthFile`'s atomic rename and
 *      hit a transient `EBUSY` on Windows, or
 *   2. A stale older sidecar (running pre-multi-account code) wrote `{}`
 *      back, then this newer reader saw the unrecognized shape and "reset"
 *      it again — ratchet, ratchet, accounts gone.
 *
 * In every failure path we now return an in-memory empty value and leave
 * the file alone. The next real save will overwrite atomically.
 */
export async function readAuthFile(): Promise<StoredAuthFile> {
    await ensureAuthFile();

    let raw: string | null = null;
    // Tiny retry loop for Windows transient share-violations during the
    // atomic rename window inside `writeAuthFile`.
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            raw = await readFile(AUTH_FILE_PATH, "utf8");
            break;
        } catch (error) {
            if (attempt === 2) {
                logger.warn(
                    "[auth] Failed to read auth file after retries (returning empty in-memory; file left untouched):",
                    error
                );
                return emptyAuthFile();
            }
            await new Promise((r) => setTimeout(r, 25 * (attempt + 1)));
        }
    }
    if (raw === null) return emptyAuthFile();

    let parsed: unknown;
    try {
        parsed = raw.trim().length === 0 ? {} : JSON.parse(raw);
    } catch (error) {
        logger.warn(
            "[auth] auth.json is not valid JSON (returning empty in-memory; file left untouched):",
            error
        );
        return emptyAuthFile();
    }

    const v2 = storedAuthFileSchema.safeParse(parsed);
    if (v2.success) {
        return v2.data;
    }

    const legacy = legacyStoredCodexAuthSchema.safeParse(parsed);
    if (legacy.success) {
        const accountId = legacy.data.accountId ?? `local-${crypto.randomUUID()}`;
        const migrated: StoredAuthFile = {
            version: 2,
            activeAccountId: accountId,
            accounts: [
                {
                    accountId,
                    email: legacy.data.email ?? null,
                    name: null,
                    label: null,
                    access: legacy.data.access,
                    refresh: legacy.data.refresh,
                    expires: legacy.data.expires,
                    connectedAt: legacy.data.connectedAt,
                    updatedAt: legacy.data.updatedAt
                }
            ]
        };
        logger.log(
            `[auth] Migrating legacy auth.json to multi-account v2 in-memory (accountId: ${accountId}); will be persisted on the next save.`
        );
        // Persist the migration via the atomic writer, but swallow errors — a
        // failure here only means the next read repeats the migration.
        try {
            await writeAuthFile(migrated);
        } catch (error) {
            logger.warn(
                "[auth] Failed to persist legacy migration (will retry on next save):",
                error
            );
        }
        return migrated;
    }

    // Empty placeholder (`{}`) or unrecognized — treat as empty IN MEMORY.
    // Never overwrite the file here — see CRITICAL note in the docstring.
    if (
        parsed === null ||
        typeof parsed !== "object" ||
        Object.keys(parsed as Record<string, unknown>).length === 0
    ) {
        return emptyAuthFile();
    }
    logger.warn(
        "[auth] auth.json shape unrecognized; returning empty in-memory and leaving file untouched. Raw keys:",
        Object.keys(parsed as Record<string, unknown>)
    );
    return emptyAuthFile();
}

/**
 * Atomic write: serialize → write to a sibling temp file → rename over the
 * target. Eliminates the window where a concurrent reader (e.g. a parallel
 * OAuth callback) could observe a half-written file and fall through to the
 * "empty placeholder" branch in `readAuthFile` — the symptom we hit before
 * was a freshly-added second account silently flipping `activeAccountId`
 * because the first read returned an empty file.
 */
export async function writeAuthFile(file: StoredAuthFile): Promise<StoredAuthFile> {
    const validated = storedAuthFileSchema.parse(file);
    await mkdir(getHomeDir(), { recursive: true });

    const serialized = serializeAuthFile(validated);
    const tempPath = `${AUTH_FILE_PATH}.tmp-${crypto.randomUUID()}`;
    try {
        await writeFile(tempPath, serialized, "utf8");
        await rename(tempPath, AUTH_FILE_PATH);
    } catch (error) {
        try {
            await unlink(tempPath);
        } catch {
            // best-effort cleanup
        }
        throw error;
    }

    return validated;
}

function cleanupExpiredOauthSessions() {
    const now = Date.now();

    for (const [sessionId, session] of pendingOauthSessions.entries()) {
        if (now - session.createdAt < OAUTH_SESSION_TTL_MS) {
            continue;
        }

        logger.log("[auth] Cleaning up expired OAuth session", sessionId);
        pendingOauthSessions.delete(sessionId);
        pendingOauthSessionsByState.delete(session.state);
    }
}

function closeOauthCallbackServer() {
    const server = oauthCallbackServer;

    oauthCallbackServer = null;
    oauthCallbackServerSessionId = null;

    if (!server) {
        return;
    }

    logger.log("[auth] Closing OAuth callback server");
    server.close(() => {
        // No-op.
    });
}

function sendHtml(response: ServerResponse, statusCode: number, html: string) {
    response.writeHead(statusCode, {
        "Content-Type": "text/html; charset=utf-8"
    });
    response.end(html);
}

function readRequestUrl(request: IncomingMessage) {
    return new URL(request.url ?? "/", `http://localhost:${CODEX_CALLBACK_PORT}`);
}

async function ensureOauthCallbackServer(sessionId: string) {
    if (oauthCallbackServerSessionId === sessionId && oauthCallbackServer) {
        return;
    }

    closeOauthCallbackServer();

    logger.log("[auth] Starting OAuth callback server on port", CODEX_CALLBACK_PORT);

    const server = createServer(async (request, response) => {
        const url = readRequestUrl(request);

        if (url.pathname !== "/auth/callback") {
            logger.warn("[auth] OAuth callback server received request to unknown path:", url.pathname);
            sendHtml(
                response,
                404,
                renderOauthResultPage({
                    success: false,
                    title: "Not found",
                    message: "Agnt is waiting for the Codex callback on this local address."
                })
            );
            return;
        }

        logger.log("[auth] Received OAuth callback");

        const result = await completeOauthConnection({
            state: url.searchParams.get("state"),
            code: url.searchParams.get("code"),
            error: url.searchParams.get("error"),
            errorDescription: url.searchParams.get("error_description")
        });

        sendHtml(response, result.statusCode, result.html);
        closeOauthCallbackServer();
    });

    await new Promise<void>((resolve, reject) => {
        server.once("error", (err) => {
            logger.error("[auth] OAuth callback server failed to start:", err);
            reject(err);
        });
        server.listen(CODEX_CALLBACK_PORT, "127.0.0.1", () => {
            server.off("error", reject);
            logger.log("[auth] OAuth callback server listening on 127.0.0.1:" + CODEX_CALLBACK_PORT);
            resolve();
        });
    });

    oauthCallbackServer = server;
    oauthCallbackServerSessionId = sessionId;
}

function parseJwtPayload(token: string) {
    const [, payload] = token.split(".");

    if (!payload) {
        return null;
    }

    try {
        const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
        const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
        const rawPayload = Buffer.from(padded, "base64").toString("utf8");
        return JSON.parse(rawPayload) as Record<string, unknown>;
    } catch {
        return null;
    }
}

function getAuthClaims(token: string) {
    const payload = parseJwtPayload(token);
    const authClaims = payload?.["https://api.openai.com/auth"];

    return authClaims && typeof authClaims === "object"
        ? (authClaims as Record<string, unknown>)
        : null;
}

function getTokenExpiry(...tokens: string[]) {
    for (const token of tokens) {
        const payload = parseJwtPayload(token);
        const exp = payload?.exp;

        if (typeof exp === "number" && Number.isFinite(exp)) {
            return new Date(exp * 1000).toISOString();
        }
    }

    return null;
}

function getCodexAccountId(idToken: string, accessToken: string) {
    const idTokenClaims = getAuthClaims(idToken);
    const accessTokenClaims = getAuthClaims(accessToken);
    const rawAccountId =
        idTokenClaims?.chatgpt_account_id ?? accessTokenClaims?.chatgpt_account_id;

    return typeof rawAccountId === "string" ? rawAccountId : null;
}

function getTokenEmail(idToken: string): string | null {
    const payload = parseJwtPayload(idToken);
    const email = payload?.email;
    return typeof email === "string" ? email : null;
}

/**
 * Pull a human-friendly display name from the id_token. ChatGPT / OpenAI
 * include the user's profile name as the standard OIDC `name` claim, with
 * `given_name` as a fallback for accounts that only set the first name.
 */
function getTokenName(idToken: string): string | null {
    const payload = parseJwtPayload(idToken);
    if (!payload) return null;
    const candidates = [
        payload.name,
        payload.preferred_username,
        payload.given_name
    ];
    for (const candidate of candidates) {
        if (typeof candidate === "string" && candidate.trim().length > 0) {
            return candidate.trim();
        }
    }
    return null;
}

/**
 * Best-effort fetch of the live ChatGPT account profile. Used to backfill
 * the display name when the id_token doesn't carry one (some accounts).
 * Returns null on any error — callers should treat the result as optional.
 */
async function fetchChatGptAccountName(input: {
    accessToken: string;
    accountIdHeader: string | null;
}): Promise<string | null> {
    try {
        const headers: Record<string, string> = {
            Authorization: `Bearer ${input.accessToken}`,
            Accept: "application/json"
        };
        if (input.accountIdHeader) {
            headers["ChatGPT-Account-Id"] = input.accountIdHeader;
        }
        const response = await fetch(
            "https://chatgpt.com/backend-api/me",
            { headers }
        );
        if (!response.ok) return null;
        const data = (await response.json()) as Record<string, unknown>;
        const name = data?.name;
        if (typeof name === "string" && name.trim().length > 0) {
            return name.trim();
        }
        return null;
    } catch (error) {
        logger.warn(
            "[auth] Failed to fetch ChatGPT profile name (non-fatal):",
            error
        );
        return null;
    }
}

function buildCodexAuthorizeUrl(input: {
    redirectUri: string;
    state: string;
    codeChallenge: string;
}) {
    const params = new URLSearchParams({
        response_type: "code",
        client_id: CODEX_CLIENT_ID,
        redirect_uri: input.redirectUri,
        scope:
            "openid profile email offline_access api.connectors.read api.connectors.invoke",
        code_challenge: input.codeChallenge,
        code_challenge_method: "S256",
        id_token_add_organizations: "true",
        codex_cli_simplified_flow: "true",
        state: input.state,
        originator: CODEX_ORIGINATOR
    });

    return `${CODEX_ISSUER}/oauth/authorize?${params.toString()}`;
}

async function exchangeCodexTokens(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
}) {
    logger.log("[auth] Exchanging authorization code for tokens");

    const body = new URLSearchParams({
        grant_type: "authorization_code",
        code: input.code,
        redirect_uri: input.redirectUri,
        client_id: CODEX_CLIENT_ID,
        code_verifier: input.codeVerifier
    });

    const response = await fetch(`${CODEX_ISSUER}/oauth/token`, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded"
        },
        body
    });

    if (!response.ok) {
        const text = await response.text();
        logger.error("[auth] Token exchange failed:", response.status, text);
        throw new Error(text || "Codex token exchange failed");
    }

    const payload = (await response.json()) as {
        id_token?: unknown;
        access_token?: unknown;
        refresh_token?: unknown;
    };

    if (
        typeof payload.id_token !== "string" ||
        typeof payload.access_token !== "string" ||
        typeof payload.refresh_token !== "string"
    ) {
        logger.error("[auth] Token exchange returned invalid payload (missing expected string fields)");
        throw new Error("Codex token exchange returned an invalid payload");
    }

    logger.log("[auth] Token exchange successful");

    return {
        idToken: payload.id_token,
        accessToken: payload.access_token,
        refreshToken: payload.refresh_token
    };
}

function renderOauthResultPage(input: {
    success: boolean;
    title: string;
    message: string;
}) {
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${input.title}</title>
  <style>
    :root {
      color-scheme: dark;
      font-family: ui-sans-serif, system-ui, sans-serif;
    }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background-color: #0d0d0d;
      color: #c9c9c9;
    }
    main {
      width: min(460px, calc(100vw - 32px));
      padding: 24px;
      border: 1px solid #2e2e2e;
      border-radius: 6px;
      background: #141414;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 14px;
      padding: 4px 10px;
      border-radius: 4px;
      font-size: 12px;
      background: ${input.success ? "rgba(52, 211, 153, 0.1)" : "rgba(248, 113, 113, 0.1)"};
      color: ${input.success ? "#6ee7b7" : "#fca5a5"};
      border: 1px solid ${input.success ? "rgba(52, 211, 153, 0.2)" : "rgba(248, 113, 113, 0.2)"};
    }
    h1 {
      margin: 0 0 8px;
      font-size: 18px;
      font-weight: 500;
      color: #f9fafb;
    }
    p {
      margin: 0;
      font-size: 14px;
      color: #828282;
      line-height: 1.6;
    }
  </style>
</head>
<body>
  <main>
    <div class="badge">${input.success ? "Connected" : "Connection failed"}</div>
    <h1>${input.title}</h1>
    <p>${input.message}</p>
  </main>
</body>
</html>`;
}

async function completeOauthConnection(input: {
    state: string | null;
    code: string | null;
    error: string | null;
    errorDescription: string | null;
}) {
    const state = input.state;

    if (!state) {
        logger.warn("[auth] OAuth callback missing state parameter");
        return {
            statusCode: 400,
            html: renderOauthResultPage({
                success: false,
                title: "Missing state",
                message: "Agnt could not match this browser login to an active Codex session."
            })
        };
    }

    const sessionId = pendingOauthSessionsByState.get(state);

    if (!sessionId) {
        logger.warn("[auth] OAuth callback with unknown/expired state");
        return {
            statusCode: 400,
            html: renderOauthResultPage({
                success: false,
                title: "Session expired",
                message: "The Codex login session is no longer active. Start the connection again in Agnt."
            })
        };
    }

    const session = pendingOauthSessions.get(sessionId);

    if (!session) {
        logger.warn("[auth] OAuth session found by state but missing from sessions map:", sessionId);
        pendingOauthSessionsByState.delete(state);
        return {
            statusCode: 400,
            html: renderOauthResultPage({
                success: false,
                title: "Session missing",
                message: "Agnt could not find the pending Codex login session."
            })
        };
    }

    if (input.error) {
        const message = input.errorDescription || input.error;
        logger.error("[auth] OAuth callback returned error:", message);
        session.status = {
            sessionId,
            status: "error",
            error: message
        };
        return {
            statusCode: 400,
            html: renderOauthResultPage({
                success: false,
                title: "Connection failed",
                message
            })
        };
    }

    if (!input.code) {
        logger.error("[auth] OAuth callback missing authorization code");
        session.status = {
            sessionId,
            status: "error",
            error: "OAuth callback did not include an authorization code"
        };
        return {
            statusCode: 400,
            html: renderOauthResultPage({
                success: false,
                title: "Missing code",
                message: "Codex did not return an authorization code."
            })
        };
    }

    try {
        const { idToken, accessToken, refreshToken } = await exchangeCodexTokens({
            code: input.code,
            codeVerifier: session.codeVerifier,
            redirectUri: session.redirectUri
        });
        const timestamp = nowIso();

        const email = getTokenEmail(idToken);
        const accountId =
            getCodexAccountId(idToken, accessToken) ??
            `local-${crypto.randomUUID()}`;

        // Prefer the id_token claim (zero extra HTTP), fall back to the
        // ChatGPT backend profile when the JWT didn't carry a name. Either
        // way `name` is optional — UI degrades gracefully to email/label.
        let name = getTokenName(idToken);
        if (!name) {
            name = await fetchChatGptAccountName({
                accessToken,
                accountIdHeader: accountId.startsWith("local-")
                    ? null
                    : accountId
            });
        }

        const stored = await addOrUpdateAccount({
            accountId,
            email,
            name,
            access: accessToken,
            refresh: refreshToken,
            expires: getTokenExpiry(accessToken, idToken),
            connectedAt: timestamp,
            updatedAt: timestamp
        });

        logger.log(
            "[auth] OAuth connection complete — email:",
            email,
            "name:",
            name,
            "accountId:",
            stored.accountId
        );

        session.status = {
            sessionId,
            status: "success",
            accountId: stored.accountId
        };

        return {
            statusCode: 200,
            html: renderOauthResultPage({
                success: true,
                title: "Codex connected",
                message: "You can return to Agnt now."
            })
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to finish Codex login";
        logger.error("[auth] OAuth completion failed:", error);
        session.status = {
            sessionId,
            status: "error",
            error: message
        };

        return {
            statusCode: 500,
            html: renderOauthResultPage({
                success: false,
                title: "Connection failed",
                message
            })
        };
    }
}

/**
 * Insert or update an account by `accountId`. Preserves the original
 * `connectedAt` on update, refreshes `updatedAt`.
 *
 * Active-account rules (in order):
 *   1. If the existing file has an `activeAccountId` AND that id is still
 *      present in the resulting accounts list, KEEP it. This is the only
 *      behavior that preserves user intent across a multi-account add.
 *   2. Otherwise, the merged account becomes active (first add, or active
 *      pointed at a row that no longer exists).
 *
 * Previously this was a single `... && accounts.some(...) ? a : b` ternary
 * which is the SAME logic, but I'm spelling it out so the intent reads
 * clearly and there's no chance of a subtle short-circuit / precedence bug
 * silently flipping `active` when adding a 2nd account.
 */
export async function addOrUpdateAccount(input: {
    accountId: string;
    email?: string | null;
    name?: string | null;
    label?: string | null;
    access: string;
    refresh: string;
    expires: string | null;
    connectedAt: string;
    updatedAt: string;
}): Promise<StoredCodexAccount> {
    const file = await readAuthFile();
    const existingIdx = file.accounts.findIndex(
        (a) => a.accountId === input.accountId
    );
    const existing = existingIdx >= 0 ? file.accounts[existingIdx] : null;

    const merged: StoredCodexAccount = storedCodexAccountSchema.parse({
        accountId: input.accountId,
        email: input.email ?? existing?.email ?? null,
        name: input.name ?? existing?.name ?? null,
        label: input.label ?? existing?.label ?? null,
        access: input.access,
        refresh: input.refresh,
        expires: input.expires,
        connectedAt: existing?.connectedAt ?? input.connectedAt,
        updatedAt: input.updatedAt
    });

    const accounts = [...file.accounts];
    if (existingIdx >= 0) {
        accounts[existingIdx] = merged;
    } else {
        accounts.push(merged);
    }

    let nextActiveAccountId: string;
    if (
        typeof file.activeAccountId === "string" &&
        file.activeAccountId.length > 0 &&
        accounts.some((a) => a.accountId === file.activeAccountId)
    ) {
        nextActiveAccountId = file.activeAccountId;
    } else {
        nextActiveAccountId = merged.accountId;
    }

    const next: StoredAuthFile = {
        version: 2,
        accounts,
        activeAccountId: nextActiveAccountId
    };

    await writeAuthFile(next);
    logger.log(
        `[auth] Wrote auth file: account ${merged.accountId} ${
            existingIdx >= 0 ? "updated" : "added"
        } (total accounts: ${accounts.length}, active: ${nextActiveAccountId}, kept-active: ${
            file.activeAccountId === nextActiveAccountId &&
            file.accounts.length > 0
        })`
    );

    // Updating the active account's tokens means callers may already hold a
    // stale token — drop WS sessions so the next turn re-handshakes fresh.
    if (next.activeAccountId === merged.accountId) {
        await notifyAccountChange();
    }

    return merged;
}

/** Remove an account by id; reassigns active to first remaining if needed. */
export async function removeAccount(accountId: string): Promise<AuthState> {
    const file = await readAuthFile();
    const filtered = file.accounts.filter((a) => a.accountId !== accountId);

    if (filtered.length === file.accounts.length) {
        logger.warn("[auth] removeAccount called with unknown id:", accountId);
        return toAuthState(file);
    }

    const next: StoredAuthFile = {
        version: 2,
        accounts: filtered,
        activeAccountId:
            file.activeAccountId === accountId
                ? (filtered[0]?.accountId ?? null)
                : file.activeAccountId
    };

    await writeAuthFile(next);
    logger.log(
        "[auth] Removed account",
        accountId,
        "(remaining:",
        filtered.length,
        ", active:",
        next.activeAccountId,
        ")"
    );

    // Clear refresh mutex for the dropped account.
    refreshMutexes.delete(accountId);

    await notifyAccountChange();
    return toAuthState(next);
}

/** Set the globally active account; closes WS sessions via listener. */
export async function setActiveAccount(accountId: string): Promise<AuthState> {
    const file = await readAuthFile();
    if (!file.accounts.some((a) => a.accountId === accountId)) {
        throw new Error(`Account ${accountId} is not connected`);
    }

    if (file.activeAccountId === accountId) {
        return toAuthState(file);
    }

    const next: StoredAuthFile = {
        ...file,
        activeAccountId: accountId
    };
    await writeAuthFile(next);
    logger.log("[auth] Active account switched to", accountId);

    await notifyAccountChange();
    return toAuthState(next);
}

/** Update the user-facing label for an account. */
export async function setAccountLabel(
    accountId: string,
    label: string | null
): Promise<AuthState> {
    const file = await readAuthFile();
    const idx = file.accounts.findIndex((a) => a.accountId === accountId);
    if (idx < 0) {
        throw new Error(`Account ${accountId} is not connected`);
    }

    const accounts = [...file.accounts];
    accounts[idx] = { ...accounts[idx]!, label, updatedAt: nowIso() };

    const next: StoredAuthFile = { ...file, accounts };
    await writeAuthFile(next);
    return toAuthState(next);
}

/** Disconnect every account and reset the file. */
export async function disconnectAll(): Promise<AuthState> {
    logger.log("[auth] Disconnecting ALL Codex accounts");
    const empty = emptyAuthFile();
    await writeAuthFile(empty);
    refreshMutexes.clear();
    await notifyAccountChange();
    return toAuthState(empty);
}

export async function listAccounts(): Promise<StoredCodexAccount[]> {
    const file = await readAuthFile();
    return file.accounts;
}

export async function getActiveAccountId(): Promise<string | null> {
    const file = await readAuthFile();
    if (
        file.activeAccountId &&
        file.accounts.some((a) => a.accountId === file.activeAccountId)
    ) {
        return file.activeAccountId;
    }
    return file.accounts[0]?.accountId ?? null;
}

/** Resolve a single account, defaulting to the active one when id omitted. */
export async function getAccount(
    accountId?: string | null
): Promise<StoredCodexAccount | null> {
    const file = await readAuthFile();
    if (file.accounts.length === 0) return null;

    const targetId =
        accountId ??
        (file.activeAccountId &&
        file.accounts.some((a) => a.accountId === file.activeAccountId)
            ? file.activeAccountId
            : file.accounts[0]?.accountId ?? null);

    if (!targetId) return null;
    return file.accounts.find((a) => a.accountId === targetId) ?? null;
}

const REFRESH_WINDOW_MS = 60 * 60 * 1000;
const refreshMutexes = new Map<string, Promise<string>>();

/**
 * Returns a non-expired access token for the requested account (or the
 * currently-active account when `accountId` is omitted). Refreshes via the
 * refresh token if the access token is within `REFRESH_WINDOW_MS` of expiry.
 *
 * Each account has its own in-flight refresh promise so concurrent requests
 * across different accounts don't serialize behind one another.
 */
export async function getValidAccessToken(
    accountId?: string | null
): Promise<string> {
    const account = await getAccount(accountId);
    if (!account) {
        throw new Error("Codex is not connected");
    }

    const inflight = refreshMutexes.get(account.accountId);
    if (inflight) {
        logger.log(
            "[auth] Token refresh already in progress for",
            account.accountId,
            "; waiting"
        );
        return inflight;
    }

    const expiresAt = account.expires ? new Date(account.expires).getTime() : 0;
    const needsRefresh = expiresAt - Date.now() < REFRESH_WINDOW_MS;

    if (!needsRefresh) {
        return account.access;
    }

    logger.log(
        "[auth] Access token needs refresh for",
        account.accountId,
        "(expires:",
        account.expires,
        ")"
    );

    const refreshPromise = (async () => {
        try {
            const response = await fetch(`${CODEX_ISSUER}/oauth/token`, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({
                    grant_type: "refresh_token",
                    refresh_token: account.refresh,
                    client_id: CODEX_CLIENT_ID
                })
            });

            if (!response.ok) {
                const text = await response.text();
                logger.error(
                    "[auth] Token refresh failed for",
                    account.accountId,
                    ":",
                    response.status,
                    text
                );
                throw new Error(text || "Codex token refresh failed");
            }

            const payload = (await response.json()) as {
                access_token?: unknown;
                refresh_token?: unknown;
            };

            if (
                typeof payload.access_token !== "string" ||
                typeof payload.refresh_token !== "string"
            ) {
                logger.error(
                    "[auth] Token refresh returned invalid payload for",
                    account.accountId
                );
                throw new Error("Codex token refresh returned an invalid payload");
            }

            await addOrUpdateAccount({
                accountId: account.accountId,
                email: account.email ?? null,
                name: account.name ?? null,
                label: account.label ?? null,
                access: payload.access_token,
                refresh: payload.refresh_token,
                expires:
                    getTokenExpiry(payload.access_token) ?? account.expires,
                connectedAt: account.connectedAt,
                updatedAt: nowIso()
            });

            logger.log(
                "[auth] Token refresh successful for",
                account.accountId
            );

            return payload.access_token;
        } finally {
            refreshMutexes.delete(account.accountId);
        }
    })();

    refreshMutexes.set(account.accountId, refreshPromise);
    return refreshPromise;
}

export async function getAuthState(): Promise<AuthState> {
    return toAuthState(await readAuthFile());
}

/**
 * Read the stored Codex account id for the active (or specified) account.
 * Returned as the value to send in the `ChatGPT-Account-Id` header on Codex
 * backend requests. Mirrors `BearerAuthProvider::add_auth_headers` in
 * `codex-rs/model-provider/src/bearer_auth_provider.rs`. Required for proper
 * billing attribution to the user's Plus/Team plan — without it, requests
 * tend to fall into a more expensive (or lower-limit) rate bucket.
 *
 * Returns `null` for synthetic local-* ids (which were generated locally
 * because the JWT didn't include the claim) — those should not be sent on
 * the wire.
 */
export async function getStoredAccountId(
    accountId?: string | null
): Promise<string | null> {
    const account = await getAccount(accountId);
    if (!account) return null;
    if (account.accountId.startsWith("local-")) return null;
    return account.accountId;
}

export async function startOauthConnection(): Promise<AuthConnectStartResponse> {
    cleanupExpiredOauthSessions();

    const sessionId = crypto.randomUUID();
    const state = createRandomToken(32);
    const codeVerifier = createRandomToken(48);
    const codeChallenge = await createCodeChallenge(codeVerifier);
    const redirectUri = `http://localhost:${CODEX_CALLBACK_PORT}/auth/callback`;
    const authUrl = buildCodexAuthorizeUrl({
        redirectUri,
        state,
        codeChallenge
    });

    logger.log("[auth] Starting OAuth connection, sessionId:", sessionId);

    pendingOauthSessions.set(sessionId, {
        sessionId,
        state,
        codeVerifier,
        redirectUri,
        status: {
            sessionId,
            status: "pending"
        },
        createdAt: Date.now()
    });
    pendingOauthSessionsByState.set(state, sessionId);

    try {
        await ensureOauthCallbackServer(sessionId);
    } catch (error) {
        pendingOauthSessions.delete(sessionId);
        pendingOauthSessionsByState.delete(state);

        logger.error("[auth] Failed to start OAuth callback server:", error);

        if (error instanceof Error) {
            throw new Error(`Unable to start Codex callback listener: ${error.message}`);
        }

        throw new Error("Unable to start Codex callback listener");
    }

    return {
        sessionId,
        authUrl
    };
}

export function getOauthSessionStatus(sessionId: string): AuthOauthSessionStatus {
    cleanupExpiredOauthSessions();

    const session = pendingOauthSessions.get(sessionId);

    if (!session) {
        logger.warn("[auth] OAuth status check for unknown/expired session:", sessionId);
        return {
            sessionId,
            status: "error",
            error: "This Codex login session has expired. Start the connection again."
        };
    }

    return session.status;
}
