import { Elysia } from "elysia";
import { ZodError } from "zod";
import { logger } from "../../lib/logger";
import {
    disconnectAuth,
    getAuthState,
    getOauthSessionStatus,
    startOauthConnection
} from "./auth.service";
import type {
    AuthConnectStartResponse,
    AuthErrorResponse,
    AuthOauthSessionStatus,
    AuthState
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
    .post("/disconnect", async (): Promise<AuthState> => {
        logger.log("[auth-routes] POST /auth/disconnect");
        return disconnectAuth();
    });

export default authRoutes;
