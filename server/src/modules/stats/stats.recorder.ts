import { getStatsDb } from "../../lib/stats-db";
import { logger } from "../../lib/logger";

/**
 * Append-only stats recorder.
 *
 * Every write goes to ~/.agnt/stats.db (see stats-db.ts). Every function here
 * swallows its own errors: stats are best-effort and must never break a
 * conversation flow.
 */

export interface RecordSessionParams {
    workspaceId: string;
    conversationId: string;
    createdAt: string;
}

export function recordStatSession(params: RecordSessionParams): void {
    const { workspaceId, conversationId, createdAt } = params;
    try {
        const db = getStatsDb();
        db.query(
            `INSERT INTO stat_sessions (id, workspace_id, conversation_id, created_at)
             VALUES (?, ?, ?, ?)`
        ).run(crypto.randomUUID(), workspaceId, conversationId, createdAt);
    } catch (error) {
        logger.error("[stats] Failed to record session", error);
    }
}

export interface RecordUserMessageParams {
    workspaceId: string;
    conversationId: string;
    messageId: string;
    createdAt: string;
}

export function recordStatUserMessage(params: RecordUserMessageParams): void {
    const { workspaceId, conversationId, messageId, createdAt } = params;
    try {
        const db = getStatsDb();
        db.query(
            `INSERT INTO stat_messages
                (id, workspace_id, conversation_id, message_id, role, model_id,
                 input_tokens, output_tokens, reasoning_tokens, total_tokens, created_at)
             VALUES (?, ?, ?, ?, 'user', NULL, NULL, NULL, NULL, NULL, ?)`
        ).run(
            crypto.randomUUID(),
            workspaceId,
            conversationId,
            messageId,
            createdAt
        );
    } catch (error) {
        logger.error("[stats] Failed to record user message", error);
    }
}

export interface RecordAssistantMessageParams {
    workspaceId: string;
    conversationId: string;
    messageId: string;
    modelId: string | null;
    inputTokens: number | null;
    outputTokens: number | null;
    reasoningTokens: number | null;
    totalTokens: number | null;
    createdAt: string;
}

export function recordStatAssistantMessage(
    params: RecordAssistantMessageParams
): void {
    const {
        workspaceId,
        conversationId,
        messageId,
        modelId,
        inputTokens,
        outputTokens,
        reasoningTokens,
        totalTokens,
        createdAt
    } = params;
    try {
        const db = getStatsDb();
        db.query(
            `INSERT INTO stat_messages
                (id, workspace_id, conversation_id, message_id, role, model_id,
                 input_tokens, output_tokens, reasoning_tokens, total_tokens, created_at)
             VALUES (?, ?, ?, ?, 'assistant', ?, ?, ?, ?, ?, ?)`
        ).run(
            crypto.randomUUID(),
            workspaceId,
            conversationId,
            messageId,
            modelId,
            inputTokens,
            outputTokens,
            reasoningTokens,
            totalTokens,
            createdAt
        );
    } catch (error) {
        logger.error("[stats] Failed to record assistant message", error);
    }
}
