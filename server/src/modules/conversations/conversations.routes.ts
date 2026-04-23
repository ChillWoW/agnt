import { Elysia } from "elysia";
import {
    listConversations,
    listSubagents,
    getConversation,
    createConversation,
    addMessage,
    deleteConversation,
    updateConversation
} from "./conversations.service";
import { streamConversationReply, streamReplyToLastMessage } from "./conversation.stream";
import { buildStreamResponse } from "./conversation.sse";
import { subscribeToConversationSse } from "./conversation-events";
import { computeContextSummary } from "./context.service";
import { compactConversation } from "./compact.service";
import type { MessageRole } from "./conversations.types";
import {
    clearConversationPermissionState,
    resolvePermission,
    type PermissionDecision
} from "./permissions";
import {
    cancelQuestions,
    clearConversationQuestionState,
    resolveQuestions
} from "./questions";
import { listTodos, replaceTodos } from "./todos";
import { getPlan, deletePlan } from "./plans";
import { mergeScopeState } from "../history/history.service";
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
    .get(
        "/:id/conversations/:conversationId/subagents",
        ({ params, set }) => {
            try {
                return {
                    subagents: listSubagents(params.id, params.conversationId)
                };
            } catch (error) {
                set.status = 500;
                return {
                    error:
                        error instanceof Error
                            ? error.message
                            : "Failed to list subagents"
                };
            }
        }
    )
    .get(
        "/:id/conversations/:conversationId/events",
        ({ params, request }) => {
            // Read-only SSE observer for an existing conversation. Does NOT
            // trigger or drive a stream — it just forwards live SSE events
            // that the conversation's primary stream is already emitting
            // through the broadcaster. Used by the subagent page to watch a
            // subagent that was started by its parent's `task` tool call.
            const conversationId = params.conversationId;
            const clientAbort = request.signal;

            return buildStreamResponse(async (controller) => {
                let closed = false;
                const unsubscribe = subscribeToConversationSse(
                    conversationId,
                    (line) => {
                        if (closed) return;
                        try {
                            controller.enqueue(line);
                        } catch {
                            closed = true;
                        }
                    }
                );

                const onAbort = () => {
                    closed = true;
                    unsubscribe();
                    try {
                        controller.close();
                    } catch {
                        // already closed
                    }
                };

                if (clientAbort.aborted) {
                    onAbort();
                    return;
                }
                clientAbort.addEventListener("abort", onAbort, { once: true });

                // Hold the stream open until the client disconnects.
                await new Promise<void>((resolve) => {
                    const interval = setInterval(() => {
                        if (closed) {
                            clearInterval(interval);
                            resolve();
                            return;
                        }
                        // Heartbeat: SSE comment lines are ignored by the
                        // parser but keep the TCP connection + buffers alive
                        // across idle periods.
                        try {
                            controller.enqueue(`: keepalive\n\n`);
                        } catch {
                            closed = true;
                            clearInterval(interval);
                            resolve();
                        }
                    }, 15000);
                });
            });
        }
    )
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
            clearConversationQuestionState(params.conversationId);
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
        "/:id/conversations/:conversationId/todos",
        ({ params, set }) => {
            try {
                return { todos: listTodos(params.id, params.conversationId) };
            } catch (error) {
                set.status = 500;
                return {
                    error:
                        error instanceof Error
                            ? error.message
                            : "Failed to list todos"
                };
            }
        }
    )
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
    )
    .post(
        "/:id/conversations/:conversationId/questions/:requestId/respond",
        ({ params, body, set }) => {
            const { answers, cancelled } = (body ?? {}) as {
                answers?: unknown;
                cancelled?: unknown;
            };

            if (cancelled === true) {
                const result = cancelQuestions(params.requestId);
                if (!result.ok) {
                    set.status = 404;
                    return { error: result.error };
                }
                return { success: true };
            }

            if (!Array.isArray(answers)) {
                set.status = 400;
                return {
                    error: "Missing or invalid 'answers' field. Expected string[][]."
                };
            }

            const normalized: string[][] = [];
            for (const group of answers) {
                if (!Array.isArray(group)) {
                    set.status = 400;
                    return {
                        error: "Each entry of 'answers' must be an array of strings."
                    };
                }
                const inner: string[] = [];
                for (const item of group) {
                    if (typeof item !== "string") {
                        set.status = 400;
                        return {
                            error: "Each entry of 'answers' must be an array of strings."
                        };
                    }
                    inner.push(item);
                }
                normalized.push(inner);
            }

            const result = resolveQuestions(params.requestId, normalized);

            if (!result.ok) {
                set.status = 404;
                return { error: result.error };
            }

            return { success: true };
        }
    )
    .get(
        "/:id/conversations/:conversationId/plan",
        ({ params, set }) => {
            try {
                const plan = getPlan(params.id, params.conversationId);
                if (!plan) {
                    set.status = 404;
                    return { error: "No plan found for this conversation" };
                }
                return { plan };
            } catch (error) {
                set.status = 500;
                return {
                    error:
                        error instanceof Error
                            ? error.message
                            : "Failed to get plan"
                };
            }
        }
    )
    .delete(
        "/:id/conversations/:conversationId/plan",
        ({ params, set }) => {
            try {
                const deleted = deletePlan(params.id, params.conversationId);
                if (!deleted) {
                    set.status = 404;
                    return { error: "No plan found for this conversation" };
                }
                return { success: true };
            } catch (error) {
                set.status = 500;
                return {
                    error:
                        error instanceof Error
                            ? error.message
                            : "Failed to delete plan"
                };
            }
        }
    )
    .post(
        "/:id/conversations/:conversationId/plan/build",
        ({ params, set }) => {
            try {
                const plan = getPlan(params.id, params.conversationId);
                if (!plan) {
                    set.status = 404;
                    return { error: "No plan found for this conversation" };
                }

                const todoInputs = plan.todos.map((t) => ({
                    content: t.content,
                    status: "pending" as const
                }));
                const todos = replaceTodos(
                    params.id,
                    params.conversationId,
                    todoInputs
                );

                mergeScopeState(
                    params.id,
                    "conversation",
                    params.conversationId,
                    { agenticMode: "agent" },
                    "plan-build"
                );

                return { success: true, todos, agenticMode: "agent" };
            } catch (error) {
                set.status = 500;
                return {
                    error:
                        error instanceof Error
                            ? error.message
                            : "Failed to build from plan"
                };
            }
        }
    );

export default conversationsRoutes;
