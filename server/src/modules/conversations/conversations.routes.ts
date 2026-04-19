import { Elysia } from "elysia";
import {
    listConversations,
    getConversation,
    createConversation,
    addMessage,
    deleteConversation,
    updateConversation
} from "./conversations.service";
import { streamConversationReply, streamReplyToLastMessage } from "./conversation.stream";
import { computeContextSummary } from "./context.service";
import { compactConversation } from "./compact.service";
import type { MessageRole } from "./conversations.types";
import {
    clearConversationPermissionState,
    resolvePermission,
    type PermissionDecision
} from "./permissions";
import type { MessageMention } from "./conversations.types";

function isPermissionDecision(value: unknown): value is PermissionDecision {
    return (
        value === "allow_once" ||
        value === "allow_session" ||
        value === "deny"
    );
}

function sanitizeMentions(raw: unknown): MessageMention[] {
    if (!Array.isArray(raw)) return [];
    const out: MessageMention[] = [];
    const seen = new Set<string>();
    for (const item of raw) {
        if (!item || typeof item !== "object") continue;
        const candidate = item as { path?: unknown; type?: unknown };
        const path =
            typeof candidate.path === "string" ? candidate.path.trim() : "";
        if (path.length === 0) continue;
        const type =
            candidate.type === "directory" ? "directory" : "file";
        const key = `${type}:${path}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ path, type });
    }
    return out;
}

const conversationsRoutes = new Elysia({ prefix: "/workspaces" })
    .get("/:id/conversations", ({ params }) => {
        return listConversations(params.id);
    })
    .post("/:id/conversations", async ({ params, body, set }) => {
        try {
            const { message, attachmentIds, mentions } = body as {
                message: string;
                attachmentIds?: unknown;
                mentions?: unknown;
            };

            if (!message || typeof message !== "string") {
                set.status = 400;
                return { error: "Missing or invalid 'message' field" };
            }

            const ids = Array.isArray(attachmentIds)
                ? (attachmentIds.filter(
                      (id) => typeof id === "string"
                  ) as string[])
                : [];

            const parsedMentions = sanitizeMentions(mentions);

            return createConversation(
                params.id,
                message,
                ids,
                parsedMentions
            );
        } catch (error) {
            set.status = 400;
            return {
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to create conversation"
            };
        }
    })
    .get("/:id/conversations/:conversationId", ({ params, set }) => {
        try {
            return getConversation(params.id, params.conversationId);
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
    .post("/:id/conversations/:conversationId/messages", async ({ params, body, set }) => {
        try {
            const { role, content } = body as { role: MessageRole; content: string };

            if (!role || !content) {
                set.status = 400;
                return { error: "Missing 'role' or 'content' field" };
            }

            return addMessage(params.id, params.conversationId, role, content);
        } catch (error) {
            set.status = error instanceof Error && error.message.includes("not found") ? 404 : 400;
            return {
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to add message"
            };
        }
    })
    .delete("/:id/conversations/:conversationId", ({ params, set }) => {
        try {
            clearConversationPermissionState(params.conversationId);
            deleteConversation(params.id, params.conversationId);
            return { success: true };
        } catch (error) {
            set.status = 404;
            return {
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to delete conversation"
            };
        }
    })
    .patch("/:id/conversations/:conversationId", async ({ params, body, set }) => {
        try {
            const { title } = body as { title?: string };
            return updateConversation(params.id, params.conversationId, { title });
        } catch (error) {
            set.status = 404;
            return {
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to update conversation"
            };
        }
    })
    .post("/:id/conversations/:conversationId/stream", async ({ params, body, request, set }) => {
        try {
            const { content, attachmentIds, mentions } = body as {
                content: string;
                attachmentIds?: unknown;
                mentions?: unknown;
            };

            if (!content || typeof content !== "string") {
                set.status = 400;
                return { error: "Missing or invalid 'content' field" };
            }

            const ids = Array.isArray(attachmentIds)
                ? (attachmentIds.filter(
                      (id) => typeof id === "string"
                  ) as string[])
                : [];

            const parsedMentions = sanitizeMentions(mentions);

            return streamConversationReply(
                params.id,
                params.conversationId,
                content,
                request.signal,
                ids,
                parsedMentions
            );
        } catch (error) {
            set.status =
                error instanceof Error && error.message.includes("not found") ? 404 : 500;
            return {
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to stream conversation reply"
            };
        }
    })
    .post("/:id/conversations/:conversationId/reply", async ({ params, request, set }) => {
        try {
            return streamReplyToLastMessage(
                params.id,
                params.conversationId,
                request.signal
            );
        } catch (error) {
            set.status =
                error instanceof Error && error.message.includes("not found") ? 404 : 500;
            return {
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to stream reply"
            };
        }
    })
    .get(
        "/:id/conversations/:conversationId/context",
        ({ params, set }) => {
            try {
                return computeContextSummary(params.id, params.conversationId);
            } catch (error) {
                set.status =
                    error instanceof Error &&
                    error.message.includes("not found")
                        ? 404
                        : 500;
                return {
                    error:
                        error instanceof Error
                            ? error.message
                            : "Failed to compute context"
                };
            }
        }
    )
    .post(
        "/:id/conversations/:conversationId/compact",
        async ({ params, set }) => {
            try {
                const result = await compactConversation(
                    params.id,
                    params.conversationId
                );
                return result;
            } catch (error) {
                set.status =
                    error instanceof Error &&
                    error.message.includes("not found")
                        ? 404
                        : 500;
                return {
                    error:
                        error instanceof Error
                            ? error.message
                            : "Failed to compact conversation"
                };
            }
        }
    )
    .post(
        "/:id/conversations/:conversationId/permissions/:requestId/respond",
        ({ params, body, set }) => {
            const { decision } = (body ?? {}) as {
                decision?: unknown;
            };

            if (!isPermissionDecision(decision)) {
                set.status = 400;
                return {
                    error:
                        "Missing or invalid 'decision' field. Expected 'allow_once', 'allow_session', or 'deny'."
                };
            }

            const result = resolvePermission(params.requestId, decision);

            if (!result.ok) {
                set.status = 404;
                return { error: result.error };
            }

            return { success: true };
        }
    );

export default conversationsRoutes;
