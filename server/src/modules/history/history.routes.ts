import { Elysia } from "elysia";
import {
    appendScopeHistory,
    getEffectiveConversationState,
    getScopeState,
    listScopeHistory,
    mergeScopeState
} from "./history.service";

function getSource(body: unknown): string | null | undefined {
    if (!body || typeof body !== "object") {
        return undefined;
    }

    const value = (body as { source?: unknown }).source;
    return typeof value === "string" ? value : undefined;
}

const historyRoutes = new Elysia({ prefix: "/workspaces" })
    .get("/:id/state", ({ params }) => {
        return getScopeState(params.id, "workspace", params.id);
    })
    .patch("/:id/state", ({ params, body, set }) => {
        try {
            const { values } = body as { values?: Record<string, unknown> };

            if (!values || typeof values !== "object" || Array.isArray(values)) {
                set.status = 400;
                return { error: "Missing or invalid 'values' field" };
            }

            return mergeScopeState(params.id, "workspace", params.id, values, getSource(body));
        } catch (error) {
            set.status = 400;
            return {
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to update workspace state"
            };
        }
    })
    .get("/:id/history", ({ params, query }) => {
        const key = typeof query.key === "string" ? query.key : undefined;
        return listScopeHistory(params.id, "workspace", params.id, key);
    })
    .post("/:id/history", ({ params, body, set }) => {
        try {
            const { key, value } = body as { key?: string; value?: unknown };

            if (!key || typeof key !== "string") {
                set.status = 400;
                return { error: "Missing or invalid 'key' field" };
            }

            return appendScopeHistory(
                params.id,
                "workspace",
                params.id,
                { key, value: value ?? null },
                getSource(body)
            );
        } catch (error) {
            set.status = 400;
            return {
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to append workspace history"
            };
        }
    })
    .get("/:id/conversations/:conversationId/state", ({ params, set }) => {
        try {
            return getScopeState(params.id, "conversation", params.conversationId);
        } catch (error) {
            set.status = 404;
            return {
                error:
                    error instanceof Error
                        ? error.message
                        : "Conversation not found"
            };
        }
    })
    .patch("/:id/conversations/:conversationId/state", ({ params, body, set }) => {
        try {
            const { values } = body as { values?: Record<string, unknown> };

            if (!values || typeof values !== "object" || Array.isArray(values)) {
                set.status = 400;
                return { error: "Missing or invalid 'values' field" };
            }

            return mergeScopeState(
                params.id,
                "conversation",
                params.conversationId,
                values,
                getSource(body)
            );
        } catch (error) {
            set.status = error instanceof Error && error.message.includes("not found") ? 404 : 400;
            return {
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to update conversation state"
            };
        }
    })
    .get("/:id/conversations/:conversationId/state/effective", ({ params, set }) => {
        try {
            return getEffectiveConversationState(params.id, params.conversationId);
        } catch (error) {
            set.status = 404;
            return {
                error:
                    error instanceof Error
                        ? error.message
                        : "Conversation not found"
            };
        }
    })
    .get("/:id/conversations/:conversationId/history", ({ params, query, set }) => {
        try {
            const key = typeof query.key === "string" ? query.key : undefined;
            return listScopeHistory(params.id, "conversation", params.conversationId, key);
        } catch (error) {
            set.status = 404;
            return {
                error:
                    error instanceof Error
                        ? error.message
                        : "Conversation not found"
            };
        }
    })
    .post("/:id/conversations/:conversationId/history", ({ params, body, set }) => {
        try {
            const { key, value } = body as { key?: string; value?: unknown };

            if (!key || typeof key !== "string") {
                set.status = 400;
                return { error: "Missing or invalid 'key' field" };
            }

            return appendScopeHistory(
                params.id,
                "conversation",
                params.conversationId,
                { key, value: value ?? null },
                getSource(body)
            );
        } catch (error) {
            set.status = error instanceof Error && error.message.includes("not found") ? 404 : 400;
            return {
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to append conversation history"
            };
        }
    });

export default historyRoutes;
