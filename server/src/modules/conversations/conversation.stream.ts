import { streamText } from "ai";
import { getWorkspaceDb } from "../../lib/db";
import { logger } from "../../lib/logger";
import { createCodexClient } from "./codex-client";
import { buildStreamResponse, sseEvent } from "./conversation.sse";
import { getEffectiveConversationState } from "../history/history.service";
import type { Message } from "./conversations.types";

const DEFAULT_MODEL = "gpt-5.4-mini";

const SYSTEM_INSTRUCTIONS = `You are Agnt, a helpful AI assistant. Help the user with their questions and tasks. Be concise and clear.`;

type ModelMessage =
    | { role: "user"; content: string }
    | { role: "assistant"; content: string };

function isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === "AbortError";
}

function finalizeAbortedAssistantMessage(
    db: ReturnType<typeof getWorkspaceDb>,
    assistantMsgId: string,
    conversationId: string,
    partialContent: string
) {
    if (partialContent.length > 0) {
        db.query("UPDATE messages SET content = ? WHERE id = ?").run(
            partialContent,
            assistantMsgId
        );
        db.query("UPDATE conversations SET updated_at = ? WHERE id = ?").run(
            new Date().toISOString(),
            conversationId
        );
        return;
    }

    db.query("DELETE FROM messages WHERE id = ?").run(assistantMsgId);
}

function buildModelMessages(messages: Message[]): ModelMessage[] {
    const result: ModelMessage[] = [];

    for (const msg of messages) {
        if (msg.role === "user" || msg.role === "assistant") {
            result.push({ role: msg.role, content: msg.content });
        }
    }

    return result;
}

function resolveConversationModel(workspaceId: string, conversationId: string): string {
    const state = getEffectiveConversationState(workspaceId, conversationId).merged;
    const configuredModel =
        typeof state.activeModel === "string"
            ? state.activeModel
            : typeof state.model === "string"
              ? state.model
              : null;

    if (!configuredModel) {
        return DEFAULT_MODEL;
    }

    const trimmed = configuredModel.trim();
    return trimmed.length > 0 ? trimmed : DEFAULT_MODEL;
}

/**
 * Generate a reply to the existing conversation without adding a new user message.
 * Used after conversation creation where the first user message is already persisted.
 */
export async function streamReplyToLastMessage(
    workspaceId: string,
    conversationId: string,
    abortSignal?: AbortSignal
): Promise<Response> {
    logger.log("[stream] streamReplyToLastMessage start", {
        workspaceId,
        conversationId
    });

    const db = getWorkspaceDb(workspaceId);

    const existing = db
        .query("SELECT id FROM conversations WHERE id = ?")
        .get(conversationId);

    if (!existing) {
        logger.error("[stream] Conversation not found:", conversationId);
        throw new Error(`Conversation not found: ${conversationId}`);
    }

    const history = db
        .query(
            "SELECT id, conversation_id, role, content, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC"
        )
        .all(conversationId) as Message[];

    logger.log("[stream] Loaded", history.length, "messages for context");

    const modelMessages = buildModelMessages(history);
    const modelName = resolveConversationModel(workspaceId, conversationId);

    const assistantMsgId = crypto.randomUUID();
    const assistantCreatedAt = new Date().toISOString();

    db.query(
        "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)"
    ).run(assistantMsgId, conversationId, "assistant", "", assistantCreatedAt);

    logger.log(
        "[stream] Created assistant placeholder message:",
        assistantMsgId
    );

    return buildStreamResponse(async (controller) => {
        controller.enqueue(
            sseEvent("assistant-start", {
                id: assistantMsgId,
                role: "assistant" as const,
                conversation_id: conversationId,
                created_at: assistantCreatedAt
            })
        );

        let fullText = "";

        try {
            const codex = await createCodexClient();

            logger.log(
                "[stream] Starting streamText with model:",
                modelName,
                "messages:",
                modelMessages.length
            );

            const result = streamText({
                model: codex.responses(modelName),
                messages: modelMessages,
                abortSignal,
                providerOptions: {
                    openai: {
                        instructions: SYSTEM_INSTRUCTIONS,
                        store: false
                    }
                },
                onAbort: () => {
                    logger.log("[stream] Reply generation aborted", {
                        workspaceId,
                        conversationId,
                        assistantMsgId
                    });
                }
            });

            for await (const part of result.fullStream) {
                if (part.type === "text-delta") {
                    fullText += part.text;
                    controller.enqueue(
                        sseEvent("delta", { content: part.text })
                    );
                } else if (part.type === "abort") {
                    finalizeAbortedAssistantMessage(
                        db,
                        assistantMsgId,
                        conversationId,
                        fullText
                    );
                    controller.enqueue(
                        sseEvent("abort", {
                            reason: part.reason ?? "aborted",
                            content: fullText,
                            assistantMessageId: assistantMsgId
                        })
                    );
                    return;
                }
            }

            logger.log(
                "[stream] Stream complete, total length:",
                fullText.length,
                "chars"
            );

            db.query("UPDATE messages SET content = ? WHERE id = ?").run(
                fullText,
                assistantMsgId
            );
            db.query(
                "UPDATE conversations SET updated_at = ? WHERE id = ?"
            ).run(new Date().toISOString(), conversationId);

            controller.enqueue(
                sseEvent("finish", {
                    reason: "stop",
                    content: fullText,
                    assistantMessageId: assistantMsgId
                })
            );
        } catch (error) {
            if (abortSignal?.aborted || isAbortError(error)) {
                logger.log("[stream] Reply stream cancelled", {
                    workspaceId,
                    conversationId,
                    assistantMsgId
                });
                finalizeAbortedAssistantMessage(
                    db,
                    assistantMsgId,
                    conversationId,
                    fullText
                );
                return;
            }

            const message =
                error instanceof Error ? error.message : "Stream failed";

            logger.error("[stream] Reply stream error:", error);

            db.query("DELETE FROM messages WHERE id = ?").run(assistantMsgId);
            controller.enqueue(sseEvent("error", { message }));
        }
    });
}

export async function streamConversationReply(
    workspaceId: string,
    conversationId: string,
    userContent: string,
    abortSignal?: AbortSignal
): Promise<Response> {
    logger.log("[stream] streamConversationReply start", {
        workspaceId,
        conversationId,
        userContentLength: userContent.length
    });

    const db = getWorkspaceDb(workspaceId);

    const existing = db
        .query("SELECT id FROM conversations WHERE id = ?")
        .get(conversationId);

    if (!existing) {
        logger.error("[stream] Conversation not found:", conversationId);
        throw new Error(`Conversation not found: ${conversationId}`);
    }

    const history = db
        .query(
            "SELECT id, conversation_id, role, content, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC"
        )
        .all(conversationId) as Message[];

    logger.log(
        "[stream] Loaded",
        history.length,
        "existing messages for context"
    );

    const userMsgId = crypto.randomUUID();
    const now = new Date().toISOString();

    db.query(
        "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)"
    ).run(userMsgId, conversationId, "user", userContent, now);

    db.query("UPDATE conversations SET updated_at = ? WHERE id = ?").run(
        now,
        conversationId
    );

    logger.log("[stream] Persisted user message:", userMsgId);

    const modelMessages = buildModelMessages([
        ...history,
        {
            id: userMsgId,
            conversation_id: conversationId,
            role: "user",
            content: userContent,
            created_at: now
        }
    ]);
    const modelName = resolveConversationModel(workspaceId, conversationId);

    const assistantMsgId = crypto.randomUUID();
    const assistantCreatedAt = new Date().toISOString();

    db.query(
        "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)"
    ).run(assistantMsgId, conversationId, "assistant", "", assistantCreatedAt);

    logger.log("[stream] Created assistant placeholder:", assistantMsgId);

    return buildStreamResponse(async (controller) => {
        controller.enqueue(
            sseEvent("user-message", {
                id: userMsgId,
                role: "user" as const,
                content: userContent,
                conversation_id: conversationId,
                created_at: now
            })
        );

        controller.enqueue(
            sseEvent("assistant-start", {
                id: assistantMsgId,
                role: "assistant" as const,
                conversation_id: conversationId,
                created_at: assistantCreatedAt
            })
        );

        let fullText = "";

        try {
            const codex = await createCodexClient();

            logger.log(
                "[stream] Starting streamText with model:",
                modelName,
                "messages:",
                modelMessages.length
            );

            const result = streamText({
                model: codex.responses(modelName),
                messages: modelMessages,
                abortSignal,
                providerOptions: {
                    openai: {
                        instructions: SYSTEM_INSTRUCTIONS,
                        store: false
                    }
                },
                onAbort: () => {
                    logger.log("[stream] Conversation generation aborted", {
                        workspaceId,
                        conversationId,
                        assistantMsgId
                    });
                }
            });

            for await (const part of result.fullStream) {
                if (part.type === "text-delta") {
                    fullText += part.text;
                    controller.enqueue(
                        sseEvent("delta", { content: part.text })
                    );
                } else if (part.type === "abort") {
                    finalizeAbortedAssistantMessage(
                        db,
                        assistantMsgId,
                        conversationId,
                        fullText
                    );
                    controller.enqueue(
                        sseEvent("abort", {
                            reason: part.reason ?? "aborted",
                            content: fullText,
                            assistantMessageId: assistantMsgId
                        })
                    );
                    return;
                }
            }

            logger.log(
                "[stream] Stream complete, total length:",
                fullText.length,
                "chars"
            );

            db.query("UPDATE messages SET content = ? WHERE id = ?").run(
                fullText,
                assistantMsgId
            );
            db.query(
                "UPDATE conversations SET updated_at = ? WHERE id = ?"
            ).run(new Date().toISOString(), conversationId);

            controller.enqueue(
                sseEvent("finish", {
                    reason: "stop",
                    content: fullText,
                    assistantMessageId: assistantMsgId
                })
            );
        } catch (error) {
            if (abortSignal?.aborted || isAbortError(error)) {
                logger.log("[stream] Conversation stream cancelled", {
                    workspaceId,
                    conversationId,
                    assistantMsgId
                });
                finalizeAbortedAssistantMessage(
                    db,
                    assistantMsgId,
                    conversationId,
                    fullText
                );
                return;
            }

            const message =
                error instanceof Error ? error.message : "Stream failed";

            logger.error("[stream] Conversation stream error:", error);

            db.query("DELETE FROM messages WHERE id = ?").run(assistantMsgId);

            controller.enqueue(sseEvent("error", { message }));
        }
    });
}
