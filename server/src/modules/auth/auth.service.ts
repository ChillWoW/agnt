import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { getHomeDir, getHomePath } from "../../lib/homedir";
import { logger } from "../../lib/logger";
import {
    authStateSchema,
    storedCodexAuthSchema,
    type AuthConnectStartResponse,
    type AuthOauthSessionStatus,
    type AuthState,
    type StoredCodexAuth
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
        await writeFile(AUTH_FILE_PATH, "{}", "utf8");
    }
}

function serializeStoredAuth(auth: StoredCodexAuth | null) {
    return JSON.stringify(auth ?? {}, null, 4);
}

function normalizeStoredAuth(input: unknown): StoredCodexAuth | null {
    const parsed = storedCodexAuthSchema.safeParse(input);
    return parsed.success ? parsed.data : null;
}

async function readStoredAuth() {
    await ensureAuthFile();
    return readFile(AUTH_FILE_PATH, "utf8");
}

function toAuthState(auth: StoredCodexAuth | null): AuthState {
    return authStateSchema.parse({
        connected: Boolean(auth),
        accountId: auth?.accountId ?? null,
        email: auth?.email ?? null,
        expires: auth?.expires ?? null,
        connectedAt: auth?.connectedAt ?? null,
        updatedAt: auth?.updatedAt ?? null
    });
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
        const existingAuth = await getStoredAuth();

        const email = getTokenEmail(idToken);
        const accountId = getCodexAccountId(idToken, accessToken);

        await writeStoredAuth({
            access: accessToken,
            refresh: refreshToken,
            expires: getTokenExpiry(accessToken, idToken),
            accountId,
            email,
            connectedAt: existingAuth?.connectedAt ?? timestamp,
            updatedAt: timestamp
        });

        logger.log("[auth] OAuth connection complete — email:", email, "accountId:", accountId);

        session.status = {
            sessionId,
            status: "success"
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

export async function getStoredAuth(): Promise<StoredCodexAuth | null> {
    try {
        const fileContents = await readStoredAuth();
        const parsed = JSON.parse(fileContents) as unknown;
        const normalized = normalizeStoredAuth(parsed);

        if (normalized || Object.keys((parsed as Record<string, unknown>) ?? {}).length === 0) {
            return normalized;
        }

        await writeStoredAuth(normalized);
        return normalized;
    } catch (error) {
        logger.warn("[auth] Failed to read stored auth, resetting:", error);
        await writeStoredAuth(null);
        return null;
    }
}

export async function writeStoredAuth(
    auth: StoredCodexAuth | null
): Promise<StoredCodexAuth | null> {
    const validated = auth ? storedCodexAuthSchema.parse(auth) : null;

    await mkdir(getHomeDir(), { recursive: true });
    await writeFile(AUTH_FILE_PATH, serializeStoredAuth(validated), "utf8");

    logger.log("[auth] Wrote auth file:", auth ? "connected" : "disconnected");

    return validated;
}

const REFRESH_WINDOW_MS = 60 * 60 * 1000;
let refreshMutex: Promise<string> | null = null;

export async function getValidAccessToken(): Promise<string> {
    if (refreshMutex) {
        logger.log("[auth] Token refresh already in progress, waiting for existing request");
        return refreshMutex;
    }

    const auth = await getStoredAuth();

    if (!auth) {
        throw new Error("Codex is not connected");
    }

    const expiresAt = auth.expires ? new Date(auth.expires).getTime() : 0;
    const needsRefresh = expiresAt - Date.now() < REFRESH_WINDOW_MS;

    if (!needsRefresh) {
        return auth.access;
    }

    logger.log("[auth] Access token needs refresh (expires:", auth.expires, ")");

    refreshMutex = (async () => {
        try {
            const response = await fetch(`${CODEX_ISSUER}/oauth/token`, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({
                    grant_type: "refresh_token",
                    refresh_token: auth.refresh,
                    client_id: CODEX_CLIENT_ID
                })
            });

            if (!response.ok) {
                const text = await response.text();
                logger.error("[auth] Token refresh failed:", response.status, text);
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
                logger.error("[auth] Token refresh returned invalid payload");
                throw new Error("Codex token refresh returned an invalid payload");
            }

            await writeStoredAuth({
                ...auth,
                access: payload.access_token,
                refresh: payload.refresh_token,
                expires: getTokenExpiry(payload.access_token) ?? auth.expires,
                updatedAt: nowIso()
            });

            logger.log("[auth] Token refresh successful");

            return payload.access_token;
        } finally {
            refreshMutex = null;
        }
    })();

    return refreshMutex;
}

export async function getAuthState(): Promise<AuthState> {
    return toAuthState(await getStoredAuth());
}

/**
 * Read the stored Codex account id (the JWT `chatgpt_account_id` claim that
 * was extracted at OAuth time). Returned as the value to send in the
 * `ChatGPT-Account-Id` header on Codex backend requests. Mirrors
 * `BearerAuthProvider::add_auth_headers` in
 * `codex-rs/model-provider/src/bearer_auth_provider.rs`. Required for proper
 * billing attribution to the user's Plus/Team plan — without it, requests
 * tend to fall into a more expensive (or lower-limit) rate bucket.
 */
export async function getStoredAccountId(): Promise<string | null> {
    const auth = await getStoredAuth();
    return auth?.accountId ?? null;
}

export async function disconnectAuth(): Promise<AuthState> {
    logger.log("[auth] Disconnecting Codex auth");
    await writeStoredAuth(null);
    return toAuthState(null);
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
