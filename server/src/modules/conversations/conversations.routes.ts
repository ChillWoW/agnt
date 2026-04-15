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
import type { MessageRole } from "./conversations.types";

const conversationsRoutes = new Elysia({ prefix: "/workspaces" })
    .get("/:id/conversations", ({ params }) => {
        return listConversations(params.id);
    })
    .post("/:id/conversations", async ({ params, body, set }) => {
        try {
            const { message } = body as { message: string };

            if (!message || typeof message !== "string") {
                set.status = 400;
                return { error: "Missing or invalid 'message' field" };
            }

            return createConversation(params.id, message);
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
    .post("/:id/conversations/:conversationId/stream", async ({ params, body, set }) => {
        try {
            const { content } = body as { content: string };

            if (!content || typeof content !== "string") {
                set.status = 400;
                return { error: "Missing or invalid 'content' field" };
            }

            return streamConversationReply(params.id, params.conversationId, content);
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
    .post("/:id/conversations/:conversationId/reply", async ({ params, set }) => {
        try {
            return streamReplyToLastMessage(params.id, params.conversationId);
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
    });

export default conversationsRoutes;
