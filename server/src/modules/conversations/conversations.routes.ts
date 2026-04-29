import { Elysia } from "elysia";
import {
    listConversations,
    listArchivedConversations,
    listSubagents,
    getConversation,
    createConversation,
    addMessage,
    deleteConversation,
    archiveConversation,
    unarchiveConversation,
    pinConversation,
    unpinConversation,
    switchBranch,
    updateConversation
} from "./conversations.service";
import {
    cancelConversationStream,
    streamConversationReply,
    streamEditAndRegenerate,
    streamRegenerateLastTurn,
    streamReplyToLastMessage
} from "./conversation.stream";
import { getWorkspaceDb } from "../../lib/db";
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

/**
 * Maximum number of skills the frontend is allowed to inject for one turn.
 * v1 only forwards the leading slash command, so this is really a "1 + a
 * little headroom" cap to keep payloads small even if a future version
 * supports multiple skills per turn.
 */
const MAX_SKILL_NAMES_PER_TURN = 4;
const SKILL_NAME_PATTERN = /^[a-zA-Z][\w-]*$/;

/**
 * Sanitize the `useSkillNames` request field: each entry must be a non-empty
 * string matching `^[a-zA-Z][\w-]*$` (matches the same shape `discoverSkills`
 * accepts as a name and the leading-slash parser produces). Lower-cased,
 * trimmed, deduped, capped at `MAX_SKILL_NAMES_PER_TURN`.
 */
function sanitizeSkillNames(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const item of raw) {
        if (typeof item !== "string") continue;
        const trimmed = item.trim();
        if (trimmed.length === 0) continue;
        if (!SKILL_NAME_PATTERN.test(trimmed)) continue;
        const key = trimmed.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(key);
        if (out.length >= MAX_SKILL_NAMES_PER_TURN) break;
    }
    return out;
}

const conversationsRoutes = new Elysia({ prefix: "/workspaces" })
    .get("/:id/conversations", ({ params }) => {
        return listConversations(params.id);
    })
    .post("/:id/conversations", async ({ params, body, set }) => {
        try {
            const { message, attachmentIds, mentions, useSkillNames } =
                body as {
                    message: string;
                    attachmentIds?: unknown;
                    mentions?: unknown;
                    useSkillNames?: unknown;
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
            const parsedSkillNames = sanitizeSkillNames(useSkillNames);

            return createConversation(
                params.id,
                message,
                ids,
                parsedMentions,
                parsedSkillNames
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
    .get("/:id/conversations/archived", ({ params, set }) => {
        try {
            return {
                conversations: listArchivedConversations(params.id)
            };
        } catch (error) {
            set.status = 500;
            return {
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to list archived conversations"
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
    .post(
        "/:id/conversations/:conversationId/archive",
        ({ params, set }) => {
            try {
                const { archived_at } = archiveConversation(
                    params.id,
                    params.conversationId
                );
                return { success: true, archived_at };
            } catch (error) {
                set.status = 404;
                return {
                    error:
                        error instanceof Error
                            ? error.message
                            : "Failed to archive conversation"
                };
            }
        }
    )
    .post(
        "/:id/conversations/:conversationId/unarchive",
        ({ params, set }) => {
            try {
                unarchiveConversation(params.id, params.conversationId);
                return { success: true };
            } catch (error) {
                set.status = 404;
                return {
                    error:
                        error instanceof Error
                            ? error.message
                            : "Failed to unarchive conversation"
                };
            }
        }
    )
    .post(
        "/:id/conversations/:conversationId/pin",
        ({ params, set }) => {
            try {
                const { pinned_at } = pinConversation(
                    params.id,
                    params.conversationId
                );
                return { success: true, pinned_at };
            } catch (error) {
                set.status = 404;
                return {
                    error:
                        error instanceof Error
                            ? error.message
                            : "Failed to pin conversation"
                };
            }
        }
    )
    .post(
        "/:id/conversations/:conversationId/unpin",
        ({ params, set }) => {
            try {
                unpinConversation(params.id, params.conversationId);
                return { success: true };
            } catch (error) {
                set.status = 404;
                return {
                    error:
                        error instanceof Error
                            ? error.message
                            : "Failed to unpin conversation"
                };
            }
        }
    )
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
            const { content, attachmentIds, mentions, useSkillNames } =
                body as {
                    content: string;
                    attachmentIds?: unknown;
                    mentions?: unknown;
                    useSkillNames?: unknown;
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
            const parsedSkillNames = sanitizeSkillNames(useSkillNames);

            return streamConversationReply(
                params.id,
                params.conversationId,
                content,
                request.signal,
                ids,
                parsedMentions,
                parsedSkillNames
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
    .post("/:id/conversations/:conversationId/stop", ({ params, body }) => {
        // Server-driven Stop. The client posts here instead of dropping
        // its SSE fetch, so the in-flight `streamText` aborts internally
        // and gets a chance to emit a final `abort` SSE event (model id +
        // generation duration + aggregated token usage) before the HTTP
        // response closes naturally. Without this route, a client-side
        // `fetch.abort()` would tear the TCP connection down before that
        // event could be flushed, leaving the assistant footer without
        // duration/cost. Idempotent: returns `stopped: false` if no stream
        // is active for the given conversation id.
        //
        // Optional body: `{ discardUserMessage: boolean }`. When true and
        // a stream was running, also delete the user message that triggered
        // the in-flight turn (the early-stop UX for "Stop pressed during
        // Planning next moves"). If the conversation has no user/assistant
        // rows left after that delete (typical for a brand-new conversation
        // where the very first turn was discarded), the conversation row
        // itself is deleted too — the client uses `conversationDeleted`
        // to navigate back to home.
        const opts =
            body && typeof body === "object"
                ? {
                      discardUserMessage: Boolean(
                          (body as Record<string, unknown>).discardUserMessage
                      )
                  }
                : { discardUserMessage: false };

        const cancelled = cancelConversationStream(params.conversationId);
        let discardedUserMessage: { id: string; content: string } | null = null;
        let conversationDeleted = false;

        if (opts.discardUserMessage && cancelled?.userMsgId) {
            const db = getWorkspaceDb(params.id);
            const row = db
                .query(
                    "SELECT id, content FROM messages WHERE id = ? AND role = 'user'"
                )
                .get(cancelled.userMsgId) as
                | { id: string; content: string }
                | null;
            if (row) {
                // Tool invocations / reasoning parts / message_attachments
                // are wiped via FK cascade (see lib/db.ts schema), so a
                // single DELETE on `messages` is enough.
                db.query("DELETE FROM messages WHERE id = ?").run(row.id);
                discardedUserMessage = { id: row.id, content: row.content };

                // Pre-empt the stream's own async cleanup and explicitly
                // remove the assistant placeholder if it's still empty.
                // The stream's `finalizeAbortedAssistantMessage` will hit
                // the same row in its `onAbort` handler, but that runs in
                // a separate task and likely hasn't fired yet — leaving
                // the placeholder in the table would make the COUNT below
                // see a non-empty conversation and skip the `deleteConversation`
                // path, stranding an empty conversation row. The DELETE is
                // idempotent so it's safe even if the stream cleanup races
                // ahead. We only delete when the placeholder is genuinely
                // empty (no content, tool invocations, or reasoning parts)
                // — the rare case where deltas arrived between the client's
                // "Planning next moves" check and this handler will leave
                // the message in place and the conversation alive.
                if (cancelled.assistantMsgId) {
                    const placeholder = db
                        .query(
                            "SELECT id, content FROM messages WHERE id = ? AND role = 'assistant'"
                        )
                        .get(cancelled.assistantMsgId) as
                        | { id: string; content: string }
                        | null;
                    if (placeholder && placeholder.content.length === 0) {
                        const toolCount = db
                            .query(
                                "SELECT COUNT(*) AS count FROM tool_invocations WHERE message_id = ?"
                            )
                            .get(cancelled.assistantMsgId) as { count: number };
                        const reasoningCount = db
                            .query(
                                "SELECT COUNT(*) AS count FROM message_reasoning_parts WHERE message_id = ?"
                            )
                            .get(cancelled.assistantMsgId) as { count: number };
                        if (
                            toolCount.count === 0 &&
                            reasoningCount.count === 0
                        ) {
                            db.query(
                                "DELETE FROM messages WHERE id = ?"
                            ).run(cancelled.assistantMsgId);
                        }
                    }
                }

                const remaining = db
                    .query(
                        "SELECT COUNT(*) AS count FROM messages WHERE conversation_id = ? AND role IN ('user','assistant')"
                    )
                    .get(params.conversationId) as { count: number };
                if (remaining.count === 0) {
                    try {
                        deleteConversation(
                            params.id,
                            params.conversationId
                        );
                        conversationDeleted = true;
                    } catch {
                        // Best-effort: if the conversation was already
                        // gone, treat it as deleted from the client's
                        // perspective so it still navigates home.
                        conversationDeleted = true;
                    }
                }
            }
        }

        return {
            success: true,
            stopped: cancelled !== null,
            discardedUserMessage,
            conversationDeleted
        };
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
    .post(
        "/:id/conversations/:conversationId/regenerate",
        async ({ params, request, set }) => {
            // Regenerate the latest assistant turn as a new branch
            // alternative. The previous response stays in the DB at
            // `branch_index = 0` so the user can flip back to it via the
            // navigator.
            try {
                return streamRegenerateLastTurn(
                    params.id,
                    params.conversationId,
                    request.signal
                );
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
                            : "Failed to regenerate"
                };
            }
        }
    )
    .post(
        "/:id/conversations/:conversationId/edit-and-regenerate",
        async ({ params, body, request, set }) => {
            // Edit the latest user message and regenerate the assistant
            // reply. Both rows fork into a new branch alternative.
            try {
                const {
                    content,
                    attachmentIds,
                    mentions,
                    useSkillNames
                } = (body ?? {}) as {
                    content?: unknown;
                    attachmentIds?: unknown;
                    mentions?: unknown;
                    useSkillNames?: unknown;
                };

                if (typeof content !== "string" || content.length === 0) {
                    set.status = 400;
                    return {
                        error: "Missing or invalid 'content' field"
                    };
                }

                const ids = Array.isArray(attachmentIds)
                    ? (attachmentIds.filter(
                          (id) => typeof id === "string"
                      ) as string[])
                    : [];

                const parsedMentions = sanitizeMentions(mentions);
                const parsedSkillNames = sanitizeSkillNames(useSkillNames);

                return streamEditAndRegenerate(
                    params.id,
                    params.conversationId,
                    content,
                    request.signal,
                    ids,
                    parsedMentions,
                    parsedSkillNames
                );
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
                            : "Failed to edit and regenerate"
                };
            }
        }
    )
    .post(
        "/:id/conversations/:conversationId/switch-branch",
        ({ params, body, set }) => {
            try {
                const { index } = (body ?? {}) as { index?: unknown };
                if (typeof index !== "number" || !Number.isInteger(index)) {
                    set.status = 400;
                    return { error: "Missing or invalid 'index' field" };
                }
                return switchBranch(params.id, params.conversationId, index);
            } catch (error) {
                const message =
                    error instanceof Error ? error.message : "Failed to switch branch";
                set.status =
                    message.includes("not found") ||
                    message.includes("no active branch group")
                        ? 404
                        : message.includes("Invalid branch index")
                          ? 400
                          : 500;
                return { error: message };
            }
        }
    )
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
