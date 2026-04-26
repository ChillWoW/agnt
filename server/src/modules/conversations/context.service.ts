import { getWorkspaceDb } from "../../lib/db";
import { countTokens } from "../../lib/tokenizer";
import { getEffectiveConversationState } from "../history/history.service";
import {
    getModelById,
    getModels
} from "../models/models.service";
import type { ModelCatalogEntry } from "../models/models.types";
import {
    listAttachmentsForMessages,
    type AttachmentRow
} from "../attachments/attachments.service";
import { estimateAttachmentTokens } from "./context.attachments";
import { DEFAULT_MODEL } from "./conversation.constants";
import { buildConversationPrompt } from "./conversation.prompt";

/** Threshold used by auto-compaction (85% of context window). */
export const COMPACT_THRESHOLD = 0.85;

/**
 * Fallback window used when the configured model is not in the catalog.
 * Matches the smallest known window so the meter errs toward compacting.
 */
const FALLBACK_CONTEXT_WINDOW = 200_000;

export interface ContextBreakdown {
    messages: number;
    reasoning: number;
    toolOutputs: number;
    attachments: number;
    repoInstructions: number;
    systemInstructions: number;
    todos: number;
}

export interface ContextSummary {
    modelId: string;
    modelDisplayName: string;
    contextWindow: number;
    maxOutputTokens: number | null;
    usedTokens: number;
    percent: number;
    breakdown: ContextBreakdown;
    messageCount: number;
    compactedMessageCount: number;
    hasCompactSummary: boolean;
    lastCompactedAt: string | null;
    autoCompactThreshold: number;
}

interface MessageTokensRow {
    id: string;
    role: "user" | "assistant" | "system";
    content: string;
    reasoning_tokens: number | null;
    compacted: number;
    created_at: string;
    summary_of_until: string | null;
}

interface ToolInvocationOutputRow {
    message_id: string;
    output_json: string | null;
    error: string | null;
}

interface CompactionMetaRow {
    created_at: string;
}

function resolveModel(
    workspaceId: string,
    conversationId: string
): ModelCatalogEntry {
    const state = getEffectiveConversationState(workspaceId, conversationId).merged;
    const configured =
        typeof state.activeModel === "string"
            ? state.activeModel
            : typeof state.model === "string"
              ? state.model
              : null;

    const trimmed = configured?.trim();
    const modelId =
        trimmed && trimmed.length > 0 ? trimmed : DEFAULT_MODEL;

    const resolved = getModelById(modelId);
    if (resolved) return resolved;

    // Last-resort fallback so we always return something the meter can use.
    const fallback =
        getModelById(DEFAULT_MODEL) ?? getModels()[0] ?? null;

    if (fallback) return fallback;

    return {
        id: modelId,
        apiModelId: modelId,
        provider: "openai",
        displayName: modelId,
        tagline: "",
        description: "",
        status: "alternative",
        releaseStage: "general",
        supportsReasoningEffort: false,
        allowedEfforts: [],
        defaultEffort: null,
        contextWindow: FALLBACK_CONTEXT_WINDOW,
        maxOutputTokens: null,
        knowledgeCutoff: null,
        speedLabel: null,
        reasoningLabel: null,
        inputModalities: ["text"],
        outputModalities: ["text"],
        supportsImageInput: false,
        supportsApi: null,
        supportsChatCompletions: null,
        supportsResponsesApi: null,
        supportsRealtimeApi: null,
        supportsBuiltInTools: null,
        supportsComputerUse: null,
        supportsWebSearch: null,
        supportsFileSearch: null,
        supportsMcp: null,
        supportsApplyPatch: null,
        supportsSkills: null,
        supportsFastMode: false,
        docsUrl: "https://example.com",
        codexDocsUrl: "https://example.com",
        access: { cli: true, ide: true, cloud: null, api: null }
    } as ModelCatalogEntry;
}

function roleOverhead(role: "user" | "assistant" | "system"): number {
    // Approximate per-message overhead used by OpenAI-format wire protocols
    // (role markers, separators). 4 tokens per message is the well-known
    // GPT-3.5/4 heuristic; close enough for the meter.
    switch (role) {
        case "system":
            return 4;
        case "user":
            return 4;
        case "assistant":
            return 4;
    }
}

export function computeContextSummary(
    workspaceId: string,
    conversationId: string
): ContextSummary {
    const db = getWorkspaceDb(workspaceId);

    const conversation = db
        .query("SELECT id FROM conversations WHERE id = ?")
        .get(conversationId);

    if (!conversation) {
        throw new Error(`Conversation not found: ${conversationId}`);
    }

    const model = resolveModel(workspaceId, conversationId);
    const contextWindow = model.contextWindow ?? FALLBACK_CONTEXT_WINDOW;

    const rows = db
        .query(
            "SELECT id, role, content, reasoning_tokens, compacted, created_at, summary_of_until FROM messages WHERE conversation_id = ? ORDER BY created_at ASC"
        )
        .all(conversationId) as MessageTokensRow[];

    const activeRows = rows.filter((row) => row.compacted === 0);
    const compactedRows = rows.filter((row) => row.compacted === 1);
    const activeMessageIds = activeRows.map((row) => row.id);

    let messagesTokens = 0;
    let reasoningTokens = 0;
    let hasCompactSummary = false;
    let lastCompactedAt: string | null = null;

    for (const row of activeRows) {
        messagesTokens += countTokens(row.content) + roleOverhead(row.role);
        if (typeof row.reasoning_tokens === "number") {
            reasoningTokens += row.reasoning_tokens;
        }
        // Only count actual compaction summary rows, not arbitrary system
        // messages. The `summary_of_until` field is set exclusively by
        // compactConversation so it's the authoritative marker.
        if (row.role === "system" && row.summary_of_until) {
            hasCompactSummary = true;
        }
    }

    if (compactedRows.length > 0 || hasCompactSummary) {
        const compactionMeta = db
            .query(
                "SELECT created_at FROM messages WHERE conversation_id = ? AND role = 'system' AND summary_of_until IS NOT NULL ORDER BY created_at DESC LIMIT 1"
            )
            .get(conversationId) as CompactionMetaRow | null;
        lastCompactedAt = compactionMeta?.created_at ?? null;
    }

    let toolOutputsTokens = 0;
    if (activeMessageIds.length > 0) {
        const placeholders = activeMessageIds.map(() => "?").join(",");
        const toolRows = db
            .query(
                `SELECT message_id, output_json, error FROM tool_invocations WHERE message_id IN (${placeholders})`
            )
            .all(...activeMessageIds) as ToolInvocationOutputRow[];
        for (const row of toolRows) {
            if (row.output_json) {
                toolOutputsTokens += countTokens(row.output_json);
            }
            if (row.error) {
                toolOutputsTokens += countTokens(row.error);
            }
        }
    }

    let attachmentsTokens = 0;
    if (activeMessageIds.length > 0) {
        const attachments = listAttachmentsForMessages(
            workspaceId,
            activeMessageIds
        );
        for (const att of attachments) {
            if (typeof att.estimated_tokens === "number") {
                attachmentsTokens += att.estimated_tokens;
                continue;
            }
            // Missing stored estimate (older rows pre-migration): recompute.
            const row = db
                .query(
                    "SELECT id, conversation_id, message_id, file_name, mime_type, size_bytes, storage_path, kind, created_at, estimated_tokens FROM attachments WHERE id = ?"
                )
                .get(att.id) as AttachmentRow | null;
            if (row) {
                const fresh = estimateAttachmentTokens(workspaceId, row);
                attachmentsTokens += fresh;
                if (fresh > 0) {
                    db.query(
                        "UPDATE attachments SET estimated_tokens = ? WHERE id = ?"
                    ).run(fresh, att.id);
                }
            }
        }
    }

    const prompt = buildConversationPrompt({
        workspaceId,
        conversationId,
        modelName: model.id
    });
    const systemInstructionsTokens = countTokens(
        prompt.identityBlock +
            prompt.communicationBlock +
            prompt.modeBlock +
            prompt.toolUseBlock +
            prompt.fileEditingBlock +
            prompt.longRunningCommandsBlock +
            prompt.gitSafetyBlock +
            prompt.environmentBlock +
            prompt.warningBlock
    );
    const repoInstructionsTokens = countTokens(prompt.repoInstructions.promptBlock);
    const todosTokens = countTokens(prompt.todosBlock);

    const usedTokens =
        messagesTokens +
        toolOutputsTokens +
        attachmentsTokens +
        repoInstructionsTokens +
        systemInstructionsTokens +
        todosTokens;

    const percent = contextWindow > 0 ? usedTokens / contextWindow : 0;

    return {
        modelId: model.id,
        modelDisplayName: model.displayName,
        contextWindow,
        maxOutputTokens: model.maxOutputTokens,
        usedTokens,
        percent,
        breakdown: {
            messages: messagesTokens,
            reasoning: reasoningTokens,
            toolOutputs: toolOutputsTokens,
            attachments: attachmentsTokens,
            repoInstructions: repoInstructionsTokens,
            systemInstructions: systemInstructionsTokens,
            todos: todosTokens
        },
        messageCount: activeRows.length,
        compactedMessageCount: compactedRows.length,
        hasCompactSummary,
        lastCompactedAt,
        autoCompactThreshold: COMPACT_THRESHOLD
    };
}
