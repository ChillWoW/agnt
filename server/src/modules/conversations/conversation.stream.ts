import { stepCountIs, streamText } from "ai";
import { getWorkspaceDb } from "../../lib/db";
import { logger } from "../../lib/logger";
import { createCodexClient } from "./codex-client";
import { buildStreamResponse, sseEvent, type SseStreamController } from "./conversation.sse";
import { getEffectiveConversationState } from "../history/history.service";
import type { Message, ToolInvocationStatus } from "./conversations.types";
import type { ReasoningEffort } from "../models/models.types";
import { getModelById } from "../models/models.service";
import { AGNT_TOOLS } from "./tools";

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

function markPendingToolInvocationsAsError(
    db: ReturnType<typeof getWorkspaceDb>,
    assistantMsgId: string,
    reason: string
) {
    db.query(
        "UPDATE tool_invocations SET status = 'error', error = ? WHERE message_id = ? AND status = 'pending'"
    ).run(reason, assistantMsgId);
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

function isReasoningEffort(value: unknown): value is ReasoningEffort {
    return (
        value === "none" ||
        value === "minimal" ||
        value === "low" ||
        value === "medium" ||
        value === "high" ||
        value === "xhigh"
    );
}

function resolveConversationModelSettings(
    workspaceId: string,
    conversationId: string
): {
    modelName: string;
    reasoningEffort: ReasoningEffort | null;
    fastMode: boolean;
} {
    const state = getEffectiveConversationState(workspaceId, conversationId).merged;
    const configuredModel =
        typeof state.activeModel === "string"
            ? state.activeModel
            : typeof state.model === "string"
              ? state.model
              : null;

    const trimmedModel = configuredModel?.trim();
    const modelName =
        trimmedModel && trimmedModel.length > 0 ? trimmedModel : DEFAULT_MODEL;
    const model = getModelById(modelName);

    const rawEffort = Object.prototype.hasOwnProperty.call(state, "reasoningEffort")
        ? state.reasoningEffort
        : state.effort ?? state.reasoning ?? null;
    const reasoningEffort =
        isReasoningEffort(rawEffort) &&
        model?.supportsReasoningEffort === true &&
        model.allowedEfforts.includes(rawEffort)
            ? rawEffort
            : model?.defaultEffort ?? null;

    return {
        modelName,
        reasoningEffort,
        fastMode: state.fastMode === true && model?.supportsFastMode === true
    };
}

function safeStringify(value: unknown): string {
    try {
        return JSON.stringify(value);
    } catch {
        return JSON.stringify(String(value));
    }
}

async function runStreamTextIntoController({
    controller,
    workspaceId,
    conversationId,
    assistantMsgId,
    modelMessages,
    abortSignal
}: {
    controller: SseStreamController;
    workspaceId: string;
    conversationId: string;
    assistantMsgId: string;
    modelMessages: ModelMessage[];
    abortSignal?: AbortSignal;
}): Promise<void> {
    const db = getWorkspaceDb(workspaceId);
    const { modelName, reasoningEffort, fastMode } =
        resolveConversationModelSettings(workspaceId, conversationId);

    let fullText = "";

    try {
        const codex = await createCodexClient();

        logger.log(
            "[stream] Starting streamText with model:",
            modelName,
            "messages:",
            modelMessages.length,
            "effort:",
            reasoningEffort,
            "fastMode:",
            fastMode
        );

        const openaiOptions: Record<string, string | boolean | undefined> = {
            instructions: SYSTEM_INSTRUCTIONS,
            store: false,
            reasoningSummary: "detailed",
            serviceTier: fastMode ? "priority" : undefined
        };

        if (reasoningEffort && reasoningEffort !== "none") {
            openaiOptions.reasoningEffort = reasoningEffort;
        }

        const result = streamText({
            model: codex.responses(modelName),
            messages: modelMessages,
            tools: AGNT_TOOLS,
            stopWhen: stepCountIs(5),
            abortSignal,
            providerOptions: {
                openai: openaiOptions
            },
            onAbort: () => {
                logger.log("[stream] Generation aborted", {
                    workspaceId,
                    conversationId,
                    assistantMsgId
                });
            }
        });

        for await (const part of result.fullStream) {
            if (part.type === "text-delta") {
                fullText += part.text;
                controller.enqueue(sseEvent("delta", { content: part.text }));
                continue;
            }

            if (part.type === "tool-call") {
                const invocationId = crypto.randomUUID();
                const createdAt = new Date().toISOString();
                const inputJson = safeStringify(part.input);
                const status: ToolInvocationStatus = "pending";

                db.query(
                    "INSERT INTO tool_invocations (id, message_id, tool_name, input_json, output_json, error, status, created_at) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?)"
                ).run(
                    invocationId,
                    assistantMsgId,
                    part.toolName,
                    inputJson,
                    status,
                    createdAt
                );

                controller.enqueue(
                    sseEvent("tool-call", {
                        id: invocationId,
                        messageId: assistantMsgId,
                        toolCallId: part.toolCallId,
                        toolName: part.toolName,
                        input: part.input,
                        status,
                        createdAt
                    })
                );
                continue;
            }

            if (part.type === "tool-result") {
                const output = part.output;
                const outputJson = safeStringify(output);
                const status: ToolInvocationStatus = "success";

                db.query(
                    "UPDATE tool_invocations SET status = ?, output_json = ?, error = NULL WHERE message_id = ? AND tool_name = ? AND status = 'pending' AND rowid = (SELECT rowid FROM tool_invocations WHERE message_id = ? AND tool_name = ? AND status = 'pending' ORDER BY created_at ASC LIMIT 1)"
                ).run(
                    status,
                    outputJson,
                    assistantMsgId,
                    part.toolName,
                    assistantMsgId,
                    part.toolName
                );

                controller.enqueue(
                    sseEvent("tool-result", {
                        messageId: assistantMsgId,
                        toolCallId: part.toolCallId,
                        toolName: part.toolName,
                        output,
                        error: null,
                        status
                    })
                );
                continue;
            }

            if (part.type === "tool-error") {
                const errorText =
                    part.error instanceof Error
                        ? part.error.message
                        : String(part.error);
                const status: ToolInvocationStatus = "error";

                db.query(
                    "UPDATE tool_invocations SET status = ?, output_json = NULL, error = ? WHERE message_id = ? AND tool_name = ? AND status = 'pending' AND rowid = (SELECT rowid FROM tool_invocations WHERE message_id = ? AND tool_name = ? AND status = 'pending' ORDER BY created_at ASC LIMIT 1)"
                ).run(
                    status,
                    errorText,
                    assistantMsgId,
                    part.toolName,
                    assistantMsgId,
                    part.toolName
                );

                controller.enqueue(
                    sseEvent("tool-result", {
                        messageId: assistantMsgId,
                        toolCallId: part.toolCallId,
                        toolName: part.toolName,
                        output: null,
                        error: errorText,
                        status
                    })
                );
                continue;
            }

            if (part.type === "abort") {
                markPendingToolInvocationsAsError(
                    db,
                    assistantMsgId,
                    "aborted"
                );
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
        db.query("UPDATE conversations SET updated_at = ? WHERE id = ?").run(
            new Date().toISOString(),
            conversationId
        );

        controller.enqueue(
            sseEvent("finish", {
                reason: "stop",
                content: fullText,
                assistantMessageId: assistantMsgId
            })
        );
    } catch (error) {
        if (abortSignal?.aborted || isAbortError(error)) {
            logger.log("[stream] Stream cancelled", {
                workspaceId,
                conversationId,
                assistantMsgId
            });
            markPendingToolInvocationsAsError(db, assistantMsgId, "aborted");
            finalizeAbortedAssistantMessage(
                db,
                assistantMsgId,
                conversationId,
                fullText
            );
            return;
        }

        const message = error instanceof Error ? error.message : "Stream failed";

        logger.error("[stream] Stream error:", error);

        markPendingToolInvocationsAsError(db, assistantMsgId, message);
        db.query("DELETE FROM messages WHERE id = ?").run(assistantMsgId);
        controller.enqueue(sseEvent("error", { message }));
    }
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

        await runStreamTextIntoController({
            controller,
            workspaceId,
            conversationId,
            assistantMsgId,
            modelMessages,
            abortSignal
        });
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

        await runStreamTextIntoController({
            controller,
            workspaceId,
            conversationId,
            assistantMsgId,
            modelMessages,
            abortSignal
        });
    });
}
