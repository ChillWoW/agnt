import { Elysia } from "elysia";
import { ZodError } from "zod";
import { logger } from "../../lib/logger";
import {
    disconnectAll,
    getAccount,
    getActiveAccountId,
    getAuthState,
    getOauthSessionStatus,
    getValidAccessToken,
    removeAccount,
    setAccountLabel,
    setActiveAccount,
    startOauthConnection
} from "./auth.service";
import {
    authRenamePayloadSchema,
    type AuthConnectStartResponse,
    type AuthErrorResponse,
    type AuthOauthSessionStatus,
    type AuthState
} from "./auth.types";

function getErrorMessage(error: unknown) {
    if (error instanceof ZodError) {
        return error.issues[0]?.message ?? "Invalid auth payload";
    }

    if (error instanceof Error) {
        return error.message;
    }

    return "Unable to process auth request";
}

const authRoutes = new Elysia({ prefix: "/auth" })
    .get("/", async (): Promise<AuthState> => {
        logger.log("[auth-routes] GET /auth");
        return getAuthState();
    })
    .post(
        "/connect/oauth/start",
        async ({ set }): Promise<AuthConnectStartResponse | AuthErrorResponse> => {
            logger.log("[auth-routes] POST /auth/connect/oauth/start");
            try {
                return await startOauthConnection();
            } catch (error) {
                logger.error("[auth-routes] OAuth start failed:", error);
                set.status = 400;
                return {
                    error: getErrorMessage(error)
                };
            }
        }
    )
    .get(
        "/oauth/status",
        async ({ query, set }): Promise<AuthOauthSessionStatus | AuthErrorResponse> => {
            try {
                if (typeof query.sessionId !== "string" || !query.sessionId) {
                    throw new Error("OAuth session id is required");
                }

                return getOauthSessionStatus(query.sessionId);
            } catch (error) {
                logger.error("[auth-routes] OAuth status check failed:", error);
                set.status = 400;
                return {
                    error: getErrorMessage(error)
                };
            }
        }
    )
    .post(
        "/accounts/:accountId/activate",
        async ({ params, set }): Promise<AuthState | AuthErrorResponse> => {
            logger.log(
                "[auth-routes] POST /auth/accounts/:accountId/activate",
                params.accountId
            );
            try {
                return await setActiveAccount(params.accountId);
            } catch (error) {
                logger.error("[auth-routes] Activate failed:", error);
                set.status = 400;
                return { error: getErrorMessage(error) };
            }
        }
    )
    .post(
        "/accounts/:accountId/disconnect",
        async ({ params, set }): Promise<AuthState | AuthErrorResponse> => {
            logger.log(
                "[auth-routes] POST /auth/accounts/:accountId/disconnect",
                params.accountId
            );
            try {
                return await removeAccount(params.accountId);
            } catch (error) {
                logger.error("[auth-routes] Disconnect single failed:", error);
                set.status = 400;
                return { error: getErrorMessage(error) };
            }
        }
    )
    .patch(
        "/accounts/:accountId",
        async ({ params, body, set }): Promise<AuthState | AuthErrorResponse> => {
            logger.log(
                "[auth-routes] PATCH /auth/accounts/:accountId",
                params.accountId
            );
            try {
                const payload = authRenamePayloadSchema.parse(body);
                return await setAccountLabel(params.accountId, payload.label);
            } catch (error) {
                logger.error("[auth-routes] Rename failed:", error);
                set.status = 400;
                return { error: getErrorMessage(error) };
            }
        }
    )
    .post("/disconnect", async (): Promise<AuthState> => {
        // Legacy single-account endpoint. Now disconnects ALL accounts so
        // outdated clients don't silently leave stale rows behind.
        logger.log("[auth-routes] POST /auth/disconnect (legacy: disconnects all)");
        return disconnectAll();
    })
    .get("/rate-limits", async ({ query, set }) => {
        logger.log("[auth-routes] GET /auth/rate-limits", query);

        try {
            const requestedAccountId =
                typeof query.accountId === "string" && query.accountId.length > 0
                    ? query.accountId
                    : null;

            const targetAccountId =
                requestedAccountId ?? (await getActiveAccountId());

            if (!targetAccountId) {
                set.status = 401;
                return { error: "Not connected" };
            }

            const account = await getAccount(targetAccountId);
            if (!account) {
                set.status = 404;
                return { error: "Account not found" };
            }

            const accessToken = await getValidAccessToken(targetAccountId);
            const headers: Record<string, string> = {
                Authorization: `Bearer ${accessToken}`
            };

            if (!account.accountId.startsWith("local-")) {
                headers["ChatGPT-Account-Id"] = account.accountId;
            }

            const response = await fetch(
                "https://chatgpt.com/backend-api/wham/usage",
                { headers }
            );

            if (!response.ok) {
                set.status = response.status;
                return { error: `Upstream error: ${response.status}` };
            }

            return response.json();
        } catch (error) {
            logger.error("[auth-routes] Rate limits fetch failed:", error);
            set.status = 500;
            return {
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to fetch rate limits"
            };
        }
    });

export default authRoutes;
