import { stepCountIs, streamText } from "ai";
import { getWorkspaceDb } from "../../lib/db";
import { logger } from "../../lib/logger";
import { createCodexClient } from "./codex-client";
import { buildStreamResponse, sseEvent, type SseStreamController } from "./conversation.sse";
import { getEffectiveConversationState } from "../history/history.service";
import type { Message, ToolInvocationStatus } from "./conversations.types";
import type { ReasoningEffort } from "../models/models.types";
import { getModelById } from "../models/models.service";
import {
    linkAttachmentsToMessage,
    listAttachmentsForMessage,
    listAttachmentsForMessages,
    readAttachmentBytes,
    type AttachmentRow
} from "../attachments/attachments.service";
import {
    abortPermissions,
    buildConversationTools,
    subscribeToPermissions,
    type PermissionMode
} from "./permissions";
import { compactConversation } from "./compact.service";
import {
    COMPACT_THRESHOLD,
    computeContextSummary
} from "./context.service";
import { countTokens } from "../../lib/tokenizer";

import { DEFAULT_MODEL, SYSTEM_INSTRUCTIONS } from "./conversation.constants";
export { DEFAULT_MODEL, SYSTEM_INSTRUCTIONS };

type UserTextPart = { type: "text"; text: string };
type UserImagePart = { type: "image"; image: Uint8Array; mediaType: string };
type UserFilePart = {
    type: "file";
    data: Uint8Array;
    mediaType: string;
    filename?: string;
};
type UserContentPart = UserTextPart | UserImagePart | UserFilePart;

type ModelMessage =
    | { role: "system"; content: string }
    | { role: "user"; content: string | UserContentPart[] }
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

const MAX_INLINE_TEXT_BYTES = 200_000;

const TEXT_MIME_PATTERNS = [
    /^text\//,
    /\+json$/,
    /\+xml$/,
    /\+yaml$/,
    /\/json$/,
    /\/xml$/,
    /\/javascript$/,
    /\/typescript$/,
    /\/yaml$/,
    /\/toml$/,
    /\/csv$/,
    /\/markdown$/,
    /\/x-sh$/,
    /\/x-shellscript$/,
    /\/x-python$/
];

function isKnownTextMime(mime: string): boolean {
    const normalized = mime.toLowerCase();
    return TEXT_MIME_PATTERNS.some((re) => re.test(normalized));
}

function looksLikeUtf8Text(bytes: Uint8Array): boolean {
    const sample = bytes.subarray(0, Math.min(bytes.byteLength, 4096));

    for (const byte of sample) {
        if (byte === 0) return false;
        if (byte === 9 || byte === 10 || byte === 13) continue;
        if (byte < 32) return false;
    }

    try {
        new TextDecoder("utf-8", { fatal: true }).decode(sample);
    } catch {
        return false;
    }

    return true;
}

function decodeAsText(bytes: Uint8Array): string {
    const truncated = bytes.byteLength > MAX_INLINE_TEXT_BYTES;
    const slice = truncated
        ? bytes.subarray(0, MAX_INLINE_TEXT_BYTES)
        : bytes;

    try {
        const text = new TextDecoder("utf-8").decode(slice);
        return truncated
            ? `${text}\n\n[...truncated ${bytes.byteLength - MAX_INLINE_TEXT_BYTES} bytes...]`
            : text;
    } catch {
        return "";
    }
}

function extFromName(name: string): string {
    const idx = name.lastIndexOf(".");
    if (idx <= 0 || idx === name.length - 1) return "";
    return name.slice(idx + 1).toLowerCase();
}

type AttachmentEncoding =
    | { kind: "image"; part: UserImagePart }
    | { kind: "pdf"; part: UserFilePart }
    | { kind: "text"; text: string }
    | { kind: "unsupported" };

function encodeAttachmentForModel(
    workspaceId: string,
    row: AttachmentRow
): AttachmentEncoding {
    let bytes: Uint8Array;
    try {
        bytes = readAttachmentBytes(workspaceId, row);
    } catch (error) {
        logger.error(
            "[stream] Failed to read attachment bytes",
            { id: row.id, path: row.storage_path },
            error
        );
        return { kind: "unsupported" };
    }

    const mime = row.mime_type.toLowerCase();

    if (mime.startsWith("image/")) {
        return {
            kind: "image",
            part: {
                type: "image",
                image: bytes,
                mediaType: row.mime_type
            }
        };
    }

    if (mime === "application/pdf") {
        return {
            kind: "pdf",
            part: {
                type: "file",
                data: bytes,
                mediaType: "application/pdf",
                filename: row.file_name
            }
        };
    }

    if (isKnownTextMime(mime) || looksLikeUtf8Text(bytes)) {
        const ext = extFromName(row.file_name);
        const fence = ext || "";
        const body = decodeAsText(bytes);
        const text = `Attached file: ${row.file_name}\n\n\`\`\`${fence}\n${body}\n\`\`\``;
        return { kind: "text", text };
    }

    logger.log(
        "[stream] Skipping unsupported attachment media type for model input",
        { id: row.id, mime: row.mime_type, name: row.file_name }
    );
    return { kind: "unsupported" };
}

function buildModelMessages(
    workspaceId: string,
    messages: Message[]
): ModelMessage[] {
    const result: ModelMessage[] = [];

    const userMessageIds = messages
        .filter((m) => m.role === "user")
        .map((m) => m.id);

    const allAttachments =
        userMessageIds.length > 0
            ? listAttachmentsForMessages(workspaceId, userMessageIds)
            : [];

    const attachmentsByMessage = new Map<string, string[]>();
    for (const att of allAttachments) {
        if (!att.message_id) continue;
        const list = attachmentsByMessage.get(att.message_id) ?? [];
        list.push(att.id);
        attachmentsByMessage.set(att.message_id, list);
    }

    for (const msg of messages) {
        if (msg.role === "assistant") {
            result.push({ role: "assistant", content: msg.content });
            continue;
        }

        if (msg.role === "system") {
            // System rows in history are compaction summaries inserted by
            // compact.service.ts. Forward them so the model keeps context
            // across a compaction.
            result.push({ role: "system", content: msg.content });
            continue;
        }

        if (msg.role !== "user") continue;

        const hasAttachments = (attachmentsByMessage.get(msg.id)?.length ?? 0) > 0;

        if (!hasAttachments) {
            result.push({ role: "user", content: msg.content });
            continue;
        }

        const rows = listAttachmentsForMessage(workspaceId, msg.id);
        const binaryParts: UserContentPart[] = [];
        const textBlocks: string[] = [];
        const skippedNames: string[] = [];

        for (const row of rows) {
            const encoded = encodeAttachmentForModel(workspaceId, row);
            switch (encoded.kind) {
                case "image":
                case "pdf":
                    binaryParts.push(encoded.part);
                    break;
                case "text":
                    textBlocks.push(encoded.text);
                    break;
                case "unsupported":
                    skippedNames.push(row.file_name);
                    break;
            }
        }

        const textSegments: string[] = [];
        if (msg.content.length > 0) {
            textSegments.push(msg.content);
        }
        for (const block of textBlocks) {
            textSegments.push(block);
        }
        if (skippedNames.length > 0) {
            textSegments.push(
                `[Note: the following attachments could not be sent to the model: ${skippedNames.join(", ")}]`
            );
        }

        const combinedText = textSegments.join("\n\n");

        if (binaryParts.length === 0) {
            result.push({
                role: "user",
                content: combinedText.length > 0 ? combinedText : msg.content
            });
            continue;
        }

        const parts: UserContentPart[] = [];
        if (combinedText.length > 0) {
            parts.push({ type: "text", text: combinedText });
        }
        parts.push(...binaryParts);

        result.push({ role: "user", content: parts });
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

function isPermissionMode(value: unknown): value is PermissionMode {
    return value === "ask" || value === "bypass";
}

function resolveConversationModelSettings(
    workspaceId: string,
    conversationId: string
): {
    modelName: string;
    reasoningEffort: ReasoningEffort | null;
    fastMode: boolean;
    permissionMode: PermissionMode;
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

    const permissionMode = isPermissionMode(state.permissionMode)
        ? state.permissionMode
        : "ask";

    return {
        modelName,
        reasoningEffort,
        fastMode: state.fastMode === true && model?.supportsFastMode === true,
        permissionMode
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
    const { modelName, reasoningEffort, fastMode, permissionMode } =
        resolveConversationModelSettings(workspaceId, conversationId);

    let fullText = "";
    let lastUsage: {
        inputTokens: number | null;
        outputTokens: number | null;
        reasoningTokens: number | null;
        totalTokens: number | null;
    } | null = null;

    const unsubscribePermissions = subscribeToPermissions(
        conversationId,
        (event) => {
            if (event.type === "requested") {
                controller.enqueue(
                    sseEvent("permission-required", {
                        id: event.request.id,
                        messageId: assistantMsgId,
                        toolName: event.request.toolName,
                        input: event.request.input,
                        createdAt: event.request.createdAt
                    })
                );
                return;
            }

            controller.enqueue(
                sseEvent("permission-resolved", {
                    id: event.requestId,
                    messageId: assistantMsgId,
                    decision: event.decision
                })
            );
        }
    );

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
            fastMode,
            "permissionMode:",
            permissionMode
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

        const tools = buildConversationTools({
            conversationId,
            getMode: () => {
                // Re-resolve permission mode from effective conversation
                // state on every tool invocation so toggling the selector
                // takes effect immediately (even mid-stream). Falls back
                // to the mode captured at stream start on any error.
                try {
                    return resolveConversationModelSettings(
                        workspaceId,
                        conversationId
                    ).permissionMode;
                } catch (error) {
                    logger.error(
                        "[stream] failed to resolve permission mode, falling back",
                        error
                    );
                    return permissionMode;
                }
            }
        });

        const result = streamText({
            model: codex.responses(modelName),
            messages: modelMessages,
            tools,
            stopWhen: stepCountIs(5),
            abortSignal,
            providerOptions: {
                openai: openaiOptions
            },
            onFinish: ({ usage }) => {
                const input =
                    typeof usage.inputTokens === "number"
                        ? usage.inputTokens
                        : null;
                const output =
                    typeof usage.outputTokens === "number"
                        ? usage.outputTokens
                        : null;
                const reasoning =
                    typeof usage.reasoningTokens === "number"
                        ? usage.reasoningTokens
                        : null;
                const total =
                    typeof usage.totalTokens === "number"
                        ? usage.totalTokens
                        : input !== null && output !== null
                          ? input + output + (reasoning ?? 0)
                          : null;

                lastUsage = {
                    inputTokens: input,
                    outputTokens: output,
                    reasoningTokens: reasoning,
                    totalTokens: total
                };

                db.query(
                    "UPDATE messages SET input_tokens = ?, output_tokens = ?, reasoning_tokens = ?, total_tokens = ? WHERE id = ?"
                ).run(input, output, reasoning, total, assistantMsgId);
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

            if (part.type === "reasoning-start") {
                controller.enqueue(
                    sseEvent("reasoning-start", { messageId: assistantMsgId })
                );
                continue;
            }

            if (part.type === "reasoning-delta") {
                controller.enqueue(
                    sseEvent("reasoning-delta", {
                        messageId: assistantMsgId,
                        text: part.text
                    })
                );
                continue;
            }

            if (part.type === "reasoning-end") {
                controller.enqueue(
                    sseEvent("reasoning-end", { messageId: assistantMsgId })
                );
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
                abortPermissions(conversationId, "aborted");
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
                assistantMessageId: assistantMsgId,
                usage: lastUsage
            })
        );
    } catch (error) {
        if (abortSignal?.aborted || isAbortError(error)) {
            logger.log("[stream] Stream cancelled", {
                workspaceId,
                conversationId,
                assistantMsgId
            });
            abortPermissions(conversationId, "aborted");
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

        abortPermissions(conversationId, message);
        markPendingToolInvocationsAsError(db, assistantMsgId, message);
        db.query("DELETE FROM messages WHERE id = ?").run(assistantMsgId);
        controller.enqueue(sseEvent("error", { message }));
    } finally {
        unsubscribePermissions();
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
            "SELECT id, conversation_id, role, content, created_at FROM messages WHERE conversation_id = ? AND compacted = 0 ORDER BY created_at ASC"
        )
        .all(conversationId) as Message[];

    logger.log("[stream] Loaded", history.length, "messages for context");

    const modelMessages = buildModelMessages(workspaceId, history);

    const assistantMsgId = crypto.randomUUID();
    const assistantCreatedAt = new Date().toISOString();

    db.query(
        "INSERT INTO messages (id, conversation_id, role, content, created_at, compacted) VALUES (?, ?, ?, ?, ?, 0)"
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
    abortSignal?: AbortSignal,
    attachmentIds: string[] = []
): Promise<Response> {
    logger.log("[stream] streamConversationReply start", {
        workspaceId,
        conversationId,
        userContentLength: userContent.length,
        attachmentCount: attachmentIds.length
    });

    const db = getWorkspaceDb(workspaceId);

    const existing = db
        .query("SELECT id FROM conversations WHERE id = ?")
        .get(conversationId);

    if (!existing) {
        logger.error("[stream] Conversation not found:", conversationId);
        throw new Error(`Conversation not found: ${conversationId}`);
    }

    let compactionEvent: {
        summaryMessageId: string;
        summarizedMessageIds: string[];
        summarizedCount: number;
        usedTokensAfter: number;
        summaryContent: string;
        summaryCreatedAt: string;
        summaryOfUntil: string;
    } | null = null;

    try {
        const currentContext = computeContextSummary(
            workspaceId,
            conversationId
        );
        const attachmentTokens =
            attachmentIds.length > 0
                ? db
                      .query(
                          `SELECT COALESCE(SUM(estimated_tokens), 0) AS total FROM attachments WHERE id IN (${attachmentIds
                              .map(() => "?")
                              .join(",")})`
                      )
                      .get(...attachmentIds) as { total: number }
                : { total: 0 };
        const projected =
            currentContext.usedTokens +
            countTokens(userContent) +
            attachmentTokens.total;
        if (
            currentContext.contextWindow > 0 &&
            projected / currentContext.contextWindow > COMPACT_THRESHOLD
        ) {
            logger.log("[stream] Auto-compact threshold hit", {
                projected,
                window: currentContext.contextWindow,
                threshold: COMPACT_THRESHOLD
            });
            const outcome = await compactConversation(
                workspaceId,
                conversationId
            );
            if (outcome.summaryMessageId) {
                compactionEvent = {
                    summaryMessageId: outcome.summaryMessageId,
                    summarizedMessageIds: outcome.summarizedMessageIds,
                    summarizedCount: outcome.summarizedCount,
                    usedTokensAfter: outcome.usedTokensAfter,
                    summaryContent: outcome.summaryContent,
                    summaryCreatedAt: outcome.summaryCreatedAt,
                    summaryOfUntil: outcome.summaryOfUntil
                };
            }
        }
    } catch (error) {
        logger.error(
            "[stream] Auto-compact check failed (continuing without compaction)",
            error
        );
    }

    const history = db
        .query(
            "SELECT id, conversation_id, role, content, created_at FROM messages WHERE conversation_id = ? AND compacted = 0 ORDER BY created_at ASC"
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
        "INSERT INTO messages (id, conversation_id, role, content, created_at, compacted) VALUES (?, ?, ?, ?, ?, 0)"
    ).run(userMsgId, conversationId, "user", userContent, now);

    db.query("UPDATE conversations SET updated_at = ? WHERE id = ?").run(
        now,
        conversationId
    );

    const linkedAttachments =
        attachmentIds.length > 0
            ? linkAttachmentsToMessage(
                  workspaceId,
                  attachmentIds,
                  conversationId,
                  userMsgId
              )
            : [];

    logger.log(
        "[stream] Persisted user message:",
        userMsgId,
        "attachments:",
        linkedAttachments.length
    );

    const modelMessages = buildModelMessages(workspaceId, [
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
        "INSERT INTO messages (id, conversation_id, role, content, created_at, compacted) VALUES (?, ?, ?, ?, ?, 0)"
    ).run(assistantMsgId, conversationId, "assistant", "", assistantCreatedAt);

    logger.log("[stream] Created assistant placeholder:", assistantMsgId);

    return buildStreamResponse(async (controller) => {
        if (compactionEvent) {
            controller.enqueue(
                sseEvent("compacted", {
                    conversation_id: conversationId,
                    ...compactionEvent
                })
            );
        }

        controller.enqueue(
            sseEvent("user-message", {
                id: userMsgId,
                role: "user" as const,
                content: userContent,
                conversation_id: conversationId,
                created_at: now,
                attachments: linkedAttachments
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
