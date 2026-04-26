import { generateText } from "ai";
import { getWorkspaceDb } from "../../lib/db";
import { logger } from "../../lib/logger";
import { getEffectiveConversationState } from "../history/history.service";
import { getModelById } from "../models/models.service";
import { createCodexClient } from "./codex-client";
import { computeContextSummary, type ContextSummary } from "./context.service";
import { DEFAULT_MODEL } from "./conversation.constants";

/** Most recent N messages kept verbatim across a compaction. */
export const COMPACT_KEEP_RECENT = 6;

const COMPACT_SYSTEM_PROMPT = `You are a conversation compaction assistant.

Produce a structured markdown summary of the conversation below so a downstream assistant can continue without losing context. Preserve:

- User intents and goals across the conversation
- Key decisions that were made
- Code snippets, file paths, commands, and identifiers mentioned (verbatim when short)
- Open questions or todos
- Any user preferences or constraints

Target well under 800 tokens. Use this exact outline:

## Conversation summary
<1-3 sentence high-level summary>

## Key decisions
- ...

## Open questions / todos
- ...

## Important references
- Files, commands, URLs, identifiers

Return only the markdown. Do not address the user.`;

interface MessageRow {
    id: string;
    role: "user" | "assistant" | "system";
    content: string;
    created_at: string;
    compacted: number;
}

export interface CompactionResult {
    summaryMessageId: string;
    summarizedMessageIds: string[];
    keptMessageIds: string[];
    summarizedCount: number;
    usedTokensAfter: number;
    context: ContextSummary;
    summaryContent: string;
    summaryCreatedAt: string;
    summaryOfUntil: string;
}

export interface CompactionSkipResult {
    summaryMessageId: null;
    summarizedMessageIds: [];
    keptMessageIds: string[];
    summarizedCount: 0;
    usedTokensAfter: number;
    context: ContextSummary;
    skipped: true;
    reason: string;
}

export type CompactOutcome = CompactionResult | CompactionSkipResult;

function resolveActiveModelId(
    workspaceId: string,
    conversationId: string
): string {
    try {
        const state = getEffectiveConversationState(
            workspaceId,
            conversationId
        ).merged;
        const configured =
            typeof state.activeModel === "string"
                ? state.activeModel
                : typeof state.model === "string"
                  ? state.model
                  : null;
        const trimmed = configured?.trim();
        if (trimmed && trimmed.length > 0 && getModelById(trimmed)) {
            return trimmed;
        }
    } catch (error) {
        logger.error(
            "[compact] failed to resolve active model, falling back",
            error
        );
    }
    return DEFAULT_MODEL;
}

function timestampBefore(iso: string): string {
    // Shift 1ms earlier so the summary sorts before the kept window.
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
        return new Date(Date.now() - 1).toISOString();
    }
    date.setMilliseconds(date.getMilliseconds() - 1);
    return date.toISOString();
}

function renderForSummary(row: MessageRow): string {
    const role =
        row.role === "assistant"
            ? "Assistant"
            : row.role === "system"
              ? "System"
              : "User";
    return `### ${role}\n${row.content.trim()}`;
}

/**
 * Summarize older messages and mark them compacted. Keeps the newest
 * COMPACT_KEEP_RECENT messages plus the most recent user message
 * (whichever set is larger) verbatim. Returns the updated context summary.
 */
export async function compactConversation(
    workspaceId: string,
    conversationId: string
): Promise<CompactOutcome> {
    const db = getWorkspaceDb(workspaceId);

    const conversation = db
        .query("SELECT id FROM conversations WHERE id = ?")
        .get(conversationId);
    if (!conversation) {
        throw new Error(`Conversation not found: ${conversationId}`);
    }

    const rows = db
        .query(
            "SELECT id, role, content, created_at, compacted FROM messages WHERE conversation_id = ? AND compacted = 0 ORDER BY created_at ASC"
        )
        .all(conversationId) as MessageRow[];

    if (rows.length === 0) {
        const context = computeContextSummary(workspaceId, conversationId);
        return {
            summaryMessageId: null,
            summarizedMessageIds: [],
            keptMessageIds: [],
            summarizedCount: 0,
            usedTokensAfter: context.usedTokens,
            context,
            skipped: true,
            reason: "No active messages to summarize"
        };
    }

    // Compute kept set: last N messages + last user message.
    const keepIds = new Set<string>();
    const tailStart = Math.max(0, rows.length - COMPACT_KEEP_RECENT);
    for (let i = tailStart; i < rows.length; i += 1) {
        keepIds.add(rows[i]!.id);
    }
    for (let i = rows.length - 1; i >= 0; i -= 1) {
        if (rows[i]!.role === "user") {
            keepIds.add(rows[i]!.id);
            break;
        }
    }

    const toSummarize = rows.filter((row) => !keepIds.has(row.id));
    const kept = rows.filter((row) => keepIds.has(row.id));

    if (toSummarize.length === 0) {
        const context = computeContextSummary(workspaceId, conversationId);
        return {
            summaryMessageId: null,
            summarizedMessageIds: [],
            keptMessageIds: kept.map((row) => row.id),
            summarizedCount: 0,
            usedTokensAfter: context.usedTokens,
            context,
            skipped: true,
            reason: "Nothing older than the kept window"
        };
    }

    const modelId = resolveActiveModelId(workspaceId, conversationId);
    logger.log("[compact] Summarizing", {
        workspaceId,
        conversationId,
        summarizing: toSummarize.length,
        keeping: kept.length,
        modelId
    });

    const codex = await createCodexClient({ conversationId });

    const summarizedText = toSummarize.map(renderForSummary).join("\n\n");

    let summaryContent: string;
    try {
        const result = await generateText({
            model: codex.responses(modelId),
            messages: [
                {
                    role: "user",
                    content: `Conversation to summarize:\n\n${summarizedText}`
                }
            ],
            providerOptions: {
                openai: {
                    instructions: COMPACT_SYSTEM_PROMPT,
                    store: false,
                    reasoningEffort: "low"
                }
            }
        });
        summaryContent = result.text.trim();
    } catch (error) {
        logger.error("[compact] Summary generation failed", error);
        throw new Error(
            error instanceof Error
                ? `Compaction failed: ${error.message}`
                : "Compaction failed"
        );
    }

    if (!summaryContent || summaryContent.length === 0) {
        throw new Error("Compaction failed: empty summary returned");
    }

    const summaryId = crypto.randomUUID();
    const earliestKeptAt = kept[0]?.created_at ?? new Date().toISOString();
    const summaryCreatedAt = timestampBefore(earliestKeptAt);
    const lastSummarizedId = toSummarize[toSummarize.length - 1]!.id;
    const summarizedIds = toSummarize.map((row) => row.id);

    const prelude = `[Compacted summary of ${toSummarize.length} earlier messages]\n\n`;
    const content = `${prelude}${summaryContent}`;

    const tx = db.transaction(() => {
        db.query(
            `INSERT INTO messages
                (id, conversation_id, role, content, created_at, compacted, summary_of_until)
             VALUES (?, ?, 'system', ?, ?, 0, ?)`
        ).run(
            summaryId,
            conversationId,
            content,
            summaryCreatedAt,
            lastSummarizedId
        );

        const placeholders = summarizedIds.map(() => "?").join(",");
        db.query(
            `UPDATE messages SET compacted = 1 WHERE id IN (${placeholders})`
        ).run(...summarizedIds);

        db.query("UPDATE conversations SET updated_at = ? WHERE id = ?").run(
            new Date().toISOString(),
            conversationId
        );
    });

    tx();

    const context = computeContextSummary(workspaceId, conversationId);

    logger.log("[compact] Done", {
        conversationId,
        summaryMessageId: summaryId,
        summarized: summarizedIds.length,
        usedAfter: context.usedTokens,
        window: context.contextWindow
    });

    return {
        summaryMessageId: summaryId,
        summarizedMessageIds: summarizedIds,
        keptMessageIds: kept.map((row) => row.id),
        summarizedCount: summarizedIds.length,
        usedTokensAfter: context.usedTokens,
        context,
        summaryContent: content,
        summaryCreatedAt: summaryCreatedAt,
        summaryOfUntil: lastSummarizedId
    };
}
