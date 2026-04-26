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

/**
 * Per-message content cap for the summarizer's INPUT prompt. Messages whose
 * raw content exceeds this are truncated to head + tail with a marker in
 * between. This keeps each message's gist (role, opening intent, closing
 * result) visible to the summarizer while preventing a single 100k-token
 * tool-output blob from blowing the summarizer's context window.
 *
 * 8000 chars ≈ 2000 tokens at the 4-chars/token estimate.
 */
const COMPACT_MAX_PER_MESSAGE_CHARS = 8000;

/**
 * Fraction of the summarizer model's context window we're willing to spend on
 * the INPUT messages prompt. The rest is reserved for the system prompt
 * (`COMPACT_SYSTEM_PROMPT`), the output, and a safety margin. 0.6 leaves
 * generous headroom for reasoning effort and "well under 800 tokens" output.
 */
const COMPACT_INPUT_BUDGET_FRACTION = 0.6;

/** Lower-bound on the input character budget regardless of model size. */
const COMPACT_MIN_INPUT_CHARS = 16_000;

/** Coarse 4-chars-per-token estimate, mirrors context.service. */
const CHARS_PER_TOKEN_ESTIMATE = 4;

/**
 * Threshold above which a single `tool_invocations.output_json` row is
 * considered "oversized" and gets physically rewritten to a sentinel
 * placeholder during compaction. 4000 chars ≈ 1000 tokens. The sentinel
 * means: the model only sees a short note on subsequent replays, the
 * context meter only counts the small placeholder, and the frontend
 * renders a "trimmed during compaction" pill instead of the full output.
 *
 * This is the *real* lever that drops post-compaction context usage from
 * ~88% (kept-window tool outputs unchanged) to ~30% (trimmed). Without it,
 * compaction can only shrink the messages-table portion of the context,
 * which is usually a small fraction of total usage in tool-heavy workflows.
 */
export const COMPACT_TOOL_OUTPUT_TRIM_AT_CHARS = 4000;

/** Sentinel marker stored as a top-level field of the trimmed JSON. */
export const COMPACT_TRIMMED_OUTPUT_FLAG = "__agnt_compact_trimmed";

export interface CompactTrimmedOutput {
    /** Always `true`; presence of this flag triggers trim-aware rendering. */
    [COMPACT_TRIMMED_OUTPUT_FLAG]: true;
    /** Char-length of the original output_json before trimming. */
    originalChars: number;
    /** Tool that produced the original output (best-effort metadata). */
    toolName: string;
    /** ISO timestamp at which the trim was applied. */
    trimmedAt: string;
    /** Human-readable placeholder text shown to the model on replay. */
    placeholder: string;
}

/** Build the sentinel object that replaces an oversized `output_json`. */
function buildTrimmedOutputSentinel(
    toolName: string,
    originalChars: number
): CompactTrimmedOutput {
    return {
        [COMPACT_TRIMMED_OUTPUT_FLAG]: true,
        originalChars,
        toolName,
        trimmedAt: new Date().toISOString(),
        placeholder: `[Tool output trimmed during context compaction. Original length: ${originalChars} chars from \`${toolName}\`. Re-run the tool if you still need this content.]`
    };
}

/** Type-guard recognized by the model-replay path AND the frontend. */
export function isCompactTrimmedOutput(
    value: unknown
): value is CompactTrimmedOutput {
    return (
        typeof value === "object" &&
        value !== null &&
        (value as Record<string, unknown>)[COMPACT_TRIMMED_OUTPUT_FLAG] ===
            true
    );
}

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

/**
 * Truncate a single message body to at most `maxChars`. Keeps a head and a
 * tail with an explicit `[... N chars truncated ...]` marker so the
 * summarizer can still see opening intent and closing result of long
 * tool-outputs / agent messages.
 */
function truncateContentForSummary(content: string, maxChars: number): string {
    if (content.length <= maxChars) return content;
    const overflow = content.length - maxChars;
    // 80% head / 20% tail — opening usually carries the user-facing intent,
    // tail usually carries the final result/answer.
    const headChars = Math.max(1, Math.floor(maxChars * 0.8));
    const tailChars = Math.max(0, maxChars - headChars - 64); // 64 chars for marker
    const head = content.slice(0, headChars);
    const tail = tailChars > 0 ? content.slice(content.length - tailChars) : "";
    return `${head}\n\n[... ${overflow} chars truncated for summarizer ...]\n\n${tail}`;
}

function renderForSummary(row: MessageRow, maxChars: number): string {
    const role =
        row.role === "assistant"
            ? "Assistant"
            : row.role === "system"
              ? "System"
              : "User";
    const trimmed = row.content.trim();
    const safe = truncateContentForSummary(trimmed, maxChars);
    return `### ${role}\n${safe}`;
}

/**
 * Build a deterministic fallback summary used when the LLM summarizer call
 * fails (e.g. the input still exceeds the model's context window, the
 * provider returns 400, the network drops, etc.). Contains enough factual
 * info that the downstream conversation can continue without losing track of
 * what was discussed, but obviously much less detail than an LLM-generated
 * summary would have.
 *
 * Critically: by returning a non-empty string this keeps `compactConversation`
 * on its happy path so the older messages still get marked `compacted=1` —
 * otherwise compaction would stay broken in a loop and every subsequent turn
 * would re-attempt the same failing LLM call.
 */
function buildDeterministicSummary(rows: MessageRow[]): string {
    const lines: string[] = [];
    lines.push("## Conversation summary");
    lines.push(
        `${rows.length} earlier message${
            rows.length === 1 ? "" : "s"
        } were compacted because the conversation exceeded the context window. The LLM-based summarizer was unavailable for this compaction (likely because the message bodies still exceeded the summarizer model's own context window after truncation), so this is a deterministic fallback summary.`
    );
    lines.push("");
    lines.push("## Compacted messages (oldest first)");

    const previewLen = 220;
    const maxPreviewedRows = 40;
    const shown = rows.slice(0, maxPreviewedRows);
    for (const row of shown) {
        const role =
            row.role === "assistant"
                ? "assistant"
                : row.role === "system"
                  ? "system"
                  : "user";
        const cleaned = row.content.replace(/\s+/g, " ").trim();
        const preview =
            cleaned.length > previewLen
                ? `${cleaned.slice(0, previewLen)}…`
                : cleaned;
        lines.push(
            `- **${role}** _${row.created_at}_ (${row.content.length} chars): ${preview}`
        );
    }
    if (rows.length > maxPreviewedRows) {
        lines.push(`- … and ${rows.length - maxPreviewedRows} more messages`);
    }

    lines.push("");
    lines.push("## Open questions / todos");
    lines.push(
        "- Detailed history not preserved — refer to the user's most recent messages for the current intent."
    );

    lines.push("");
    lines.push("## Important references");
    lines.push(
        "- Full text of compacted messages remains in the database (compacted=1 rows) for audit; only the in-prompt context was discarded."
    );

    return lines.join("\n");
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
    const modelEntry = getModelById(modelId);
    const modelContextWindow = modelEntry?.contextWindow ?? 0;
    const inputCharBudget = Math.max(
        COMPACT_MIN_INPUT_CHARS,
        Math.floor(
            modelContextWindow *
                CHARS_PER_TOKEN_ESTIMATE *
                COMPACT_INPUT_BUDGET_FRACTION
        )
    );

    // Per-message truncation pass.
    let perMessageCap = COMPACT_MAX_PER_MESSAGE_CHARS;
    let summarizedText = toSummarize
        .map((row) => renderForSummary(row, perMessageCap))
        .join("\n\n");

    // If still over the total input budget, halve the per-message cap until
    // we fit (or drop to a minimum of ~512 chars per message). This keeps the
    // summarizer's prompt within the model's context window even when there
    // are many oversized rows (e.g. dozens of giant tool-outputs).
    while (
        summarizedText.length > inputCharBudget &&
        perMessageCap > 512
    ) {
        perMessageCap = Math.max(512, Math.floor(perMessageCap / 2));
        summarizedText = toSummarize
            .map((row) => renderForSummary(row, perMessageCap))
            .join("\n\n");
    }

    // Final hard cap: if we still don't fit (huge number of rows), tail-clip
    // the joined text. The summarizer will see the most recent portion which
    // is usually the most relevant.
    let hardClipped = false;
    if (summarizedText.length > inputCharBudget) {
        const overflow = summarizedText.length - inputCharBudget;
        summarizedText = `[... ${overflow} chars of older messages truncated to fit summarizer context window ...]\n\n${summarizedText.slice(
            summarizedText.length - inputCharBudget
        )}`;
        hardClipped = true;
    }

    logger.log("[compact] Summarizing", {
        workspaceId,
        conversationId,
        summarizing: toSummarize.length,
        keeping: kept.length,
        modelId,
        modelContextWindow,
        inputCharBudget,
        finalInputChars: summarizedText.length,
        perMessageCap,
        hardClipped
    });

    const codex = await createCodexClient({ conversationId });

    let summaryContent: string;
    let summarizerFailed = false;
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
        if (!summaryContent || summaryContent.length === 0) {
            logger.error(
                "[compact] Summarizer returned empty text — falling back to deterministic summary",
                { conversationId, modelId }
            );
            summaryContent = buildDeterministicSummary(toSummarize);
            summarizerFailed = true;
        }
    } catch (error) {
        // The LLM call failed (most commonly: input still exceeds the
        // model's actual context window after our truncation, or the
        // provider returned 4xx/5xx, or the network dropped). Instead of
        // aborting compaction — which would leave the conversation in a
        // permanent overflow loop, since the same call would fail next turn
        // too — fall back to a deterministic factual summary. The older
        // messages still get marked compacted=1 below.
        logger.error(
            "[compact] LLM summarization failed — falling back to deterministic summary",
            error
        );
        summaryContent = buildDeterministicSummary(toSummarize);
        summarizerFailed = true;
    }

    const summaryId = crypto.randomUUID();
    const earliestKeptAt = kept[0]?.created_at ?? new Date().toISOString();
    const summaryCreatedAt = timestampBefore(earliestKeptAt);
    const lastSummarizedId = toSummarize[toSummarize.length - 1]!.id;
    const summarizedIds = toSummarize.map((row) => row.id);

    const prelude = `[Compacted summary of ${toSummarize.length} earlier messages]\n\n`;
    const content = `${prelude}${summaryContent}`;

    // Identify oversized tool_invocations rows BEFORE the transaction so we
    // can rewrite them in-place. We trim:
    //   - all tool_invocations of the SUMMARIZED messages (they're about to be
    //     marked compacted=1; their full output is no longer needed)
    //   - oversized tool_invocations of the KEPT messages (these are the ones
    //     that bloat the post-compaction context — they survive compaction
    //     but each can carry 10-25k tokens of read_file/grep output and are
    //     what's keeping context at ~88% even after compaction)
    const allMessageIds = [...summarizedIds, ...kept.map((row) => row.id)];
    interface ToolInvocationTrimRow {
        id: string;
        message_id: string;
        tool_name: string;
        output_size: number;
    }
    let trimRows: ToolInvocationTrimRow[] = [];
    if (allMessageIds.length > 0) {
        const placeholders = allMessageIds.map(() => "?").join(",");
        trimRows = db
            .query(
                `SELECT id, message_id, tool_name, LENGTH(output_json) AS output_size
                 FROM tool_invocations
                 WHERE message_id IN (${placeholders})
                   AND output_json IS NOT NULL`
            )
            .all(...allMessageIds) as ToolInvocationTrimRow[];
    }
    const summarizedIdSet = new Set(summarizedIds);
    const toTrim = trimRows.filter(
        (row) =>
            summarizedIdSet.has(row.message_id) ||
            row.output_size >= COMPACT_TOOL_OUTPUT_TRIM_AT_CHARS
    );

    let toolOutputCharsSaved = 0;
    let toolOutputsTrimmedCount = 0;

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

        for (const row of toTrim) {
            const sentinel = buildTrimmedOutputSentinel(
                row.tool_name,
                row.output_size
            );
            const newJson = JSON.stringify(sentinel);
            db.query(
                "UPDATE tool_invocations SET output_json = ?, error = NULL WHERE id = ?"
            ).run(newJson, row.id);
            toolOutputCharsSaved += Math.max(0, row.output_size - newJson.length);
            toolOutputsTrimmedCount += 1;
        }

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
        toolOutputsTrimmedCount,
        toolOutputCharsSaved,
        usedAfter: context.usedTokens,
        window: context.contextWindow,
        summarizerFailed
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
