import {
    stepCountIs,
    streamText,
    type ModelMessage as SdkModelMessage,
    type ToolCallPart as SdkToolCallPart,
    type ToolResultPart as SdkToolResultPart
} from "ai";

type SdkToolResultOutput = SdkToolResultPart["output"];
import { getWorkspaceDb } from "../../lib/db";
import { logger } from "../../lib/logger";
import { getWorkspace } from "../workspaces/workspaces.service";
import { createCodexWsModel } from "./codex-websocket-provider";
import {
    buildStreamResponse,
    sseEvent,
    type SseStreamController
} from "./conversation.sse";
import { getEffectiveConversationState } from "../history/history.service";
import type {
    Message,
    ToolInvocation,
    ToolInvocationStatus
} from "./conversations.types";
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
    type PermissionMode,
    type AgenticMode
} from "./permissions";
import { AGNT_TOOL_DEF_BY_NAME } from "./tools";
import type { ToolModelOutput } from "./tools/types";
import { abortQuestions, subscribeToQuestions } from "./questions";
import { subscribeToTodos } from "./todos";
import {
    killForegroundForConversation,
    subscribeToShellLifecycle,
    subscribeToShellProgress
} from "./shell";
import {
    registerToolInvocationContext,
    unregisterToolInvocationContext
} from "./shell/tool-context";
import {
    compactConversation,
    isCompactTrimmedOutput
} from "./compact.service";
import { COMPACT_THRESHOLD, computeContextSummary } from "./context.service";
import { countTokens } from "../../lib/tokenizer";
import { subscribeToPlanUpdates } from "./plans";
import {
    abortSubagentsForParent,
    getSubagentTypeConfig,
    subscribeToSubagentLifecycle
} from "./subagents";
import { wrapControllerWithBroadcast } from "./conversation-events";
import {
    recordStatAssistantMessage,
    recordStatUserMessage
} from "../stats/stats.recorder";

import {
    DEFAULT_CONVERSATION_TITLE,
    DEFAULT_MODEL
} from "./conversation.constants";
import { buildConversationPrompt } from "./conversation.prompt";
import { generateConversationTitleIfNeeded } from "./conversation-title";
import {
    buildMentionsInstructionBlock,
    parseMentionsFromContent
} from "./mentions";
import type { MessageMention, SubagentType } from "./conversations.types";
import {
    buildActiveSkillsBlock,
    findSkill,
    listSkillFiles,
    type Skill
} from "../skills/skills.service";
export { DEFAULT_MODEL };

const DEFAULT_SUBAGENT_MODEL = "gpt-5.4-mini";
const DEFAULT_SUBAGENT_REASONING_EFFORT: ReasoningEffort = "high";

type UserTextPart = { type: "text"; text: string };
type UserImagePart = { type: "image"; image: Uint8Array; mediaType: string };
type UserFilePart = {
    type: "file";
    data: Uint8Array;
    mediaType: string;
    filename?: string;
};
type UserContentPart = UserTextPart | UserImagePart | UserFilePart;

type AssistantTextPart = { type: "text"; text: string };
type AssistantContentPart = AssistantTextPart | SdkToolCallPart;

type ModelMessage =
    | { role: "system"; content: string }
    | { role: "user"; content: string | UserContentPart[] }
    | { role: "assistant"; content: string | AssistantContentPart[] }
    | { role: "tool"; content: SdkToolResultPart[] };

function isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === "AbortError";
}

interface StreamReasoningPart {
    id: string;
    text: string;
    startedAt: string;
    endedAt: string | null;
    sortIndex: number;
    messageSeq: number;
}

function finalizeAbortedAssistantMessage(
    db: ReturnType<typeof getWorkspaceDb>,
    assistantMsgId: string,
    conversationId: string,
    partialContent: string,
    reasoningParts: StreamReasoningPart[]
) {
    const hasReasoning = reasoningParts.some((part) => part.text.length > 0);
    if (partialContent.length > 0 || hasReasoning) {
        const legacyText =
            reasoningParts
                .map((part) => part.text)
                .filter((text) => text.length > 0)
                .join("\n\n") || null;
        const firstStartedAt =
            reasoningParts.find((part) => part.text.length > 0)?.startedAt ??
            null;
        const lastEndedAt =
            [...reasoningParts].reverse().find((part) => part.endedAt)
                ?.endedAt ?? null;

        db.query(
            "UPDATE messages SET content = ?, reasoning_content = ?, reasoning_started_at = ?, reasoning_ended_at = ? WHERE id = ?"
        ).run(
            partialContent,
            legacyText,
            firstStartedAt,
            lastEndedAt,
            assistantMsgId
        );

        const finalizedAt = new Date().toISOString();
        const upsert = db.query(
            "INSERT INTO message_reasoning_parts (id, message_id, text, started_at, ended_at, sort_index, message_seq) VALUES (?, ?, ?, ?, ?, ?, ?) " +
                "ON CONFLICT(id) DO UPDATE SET text = excluded.text, ended_at = COALESCE(message_reasoning_parts.ended_at, excluded.ended_at)"
        );
        for (const part of reasoningParts) {
            if (part.text.length === 0) continue;
            upsert.run(
                part.id,
                assistantMsgId,
                part.text,
                part.startedAt,
                part.endedAt ?? finalizedAt,
                part.sortIndex,
                part.messageSeq
            );
        }

        db.query("UPDATE conversations SET updated_at = ? WHERE id = ?").run(
            finalizedAt,
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
    const slice = truncated ? bytes.subarray(0, MAX_INLINE_TEXT_BYTES) : bytes;

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

interface ToolInvocationRow {
    id: string;
    message_id: string;
    tool_name: string;
    input_json: string;
    output_json: string | null;
    error: string | null;
    status: ToolInvocationStatus;
    created_at: string;
    message_seq: number | null;
}

function parseJsonOrRaw(value: string | null): unknown {
    if (value === null) return null;
    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
}

function loadToolInvocationsByMessage(
    workspaceId: string,
    messageIds: string[]
): Map<string, ToolInvocation[]> {
    const byMessage = new Map<string, ToolInvocation[]>();
    if (messageIds.length === 0) return byMessage;

    const db = getWorkspaceDb(workspaceId);
    const placeholders = messageIds.map(() => "?").join(",");
    const rows = db
        .query(
            `SELECT id, message_id, tool_name, input_json, output_json, error, status, created_at, message_seq
             FROM tool_invocations
             WHERE message_id IN (${placeholders})
             ORDER BY message_seq ASC, created_at ASC`
        )
        .all(...messageIds) as ToolInvocationRow[];

    for (const row of rows) {
        const list = byMessage.get(row.message_id) ?? [];
        list.push({
            id: row.id,
            message_id: row.message_id,
            tool_name: row.tool_name,
            input: parseJsonOrRaw(row.input_json),
            output: parseJsonOrRaw(row.output_json),
            error: row.error,
            status: row.status,
            created_at: row.created_at,
            message_seq: row.message_seq ?? null
        });
        byMessage.set(row.message_id, list);
    }
    return byMessage;
}

function modelOutputToSdk(output: ToolModelOutput): SdkToolResultOutput {
    // Both shapes happen to line up for text/json/content — cast the value
    // fields without per-key validation. We trust each tool's own
    // `toModelOutput` to return a well-formed shape.
    if (output.type === "text") {
        return { type: "text", value: output.value };
    }
    if (output.type === "json") {
        return {
            type: "json",
            value: output.value as SdkToolResultOutput extends {
                type: "json";
                value: infer V;
            }
                ? V
                : never
        };
    }
    return {
        type: "content",
        value: output.value as SdkToolResultOutput extends {
            type: "content";
            value: infer V;
        }
            ? V
            : never
    };
}

function toolResultOutputFromInvocation(
    invocation: ToolInvocation
): SdkToolResultOutput {
    if (invocation.status === "error") {
        const errorText =
            invocation.error ??
            "Tool call failed without a recorded error message.";
        return { type: "error-text", value: errorText };
    }

    if (invocation.status === "pending") {
        // The prior stream ended before this tool produced a result. Surface
        // that as an error so the model understands the call was interrupted
        // rather than silently missing output.
        return {
            type: "error-text",
            value: "Tool call was interrupted before producing a result."
        };
    }

    const output = invocation.output;
    if (output === null || output === undefined) {
        return { type: "text", value: "" };
    }

    // If the output_json was trimmed during compaction (see
    // `compact.service.ts` -> `buildTrimmedOutputSentinel`), short-circuit:
    // the model just sees the placeholder text and the tool-specific
    // `toModelOutput` is not invoked (it would crash on the sentinel shape
    // anyway since it's not the tool's expected output schema).
    if (isCompactTrimmedOutput(output)) {
        return { type: "text", value: output.placeholder };
    }

    // Apply the tool's toModelOutput on replay so the stored raw JSON
    // (which can be >1 MiB for shell/await_shell/apply_patch) is narrowed
    // to the same compact text/summary the model saw on the original turn.
    // Without this, every subsequent turn re-injects the full stored
    // payload into the prompt, exploding context.
    const def = AGNT_TOOL_DEF_BY_NAME[invocation.tool_name];
    if (def?.toModelOutput) {
        try {
            const narrowed = def.toModelOutput({
                input: (invocation.input ?? {}) as object,
                output
            });
            if (narrowed && typeof (narrowed as Promise<unknown>).then !== "function") {
                return modelOutputToSdk(narrowed as ToolModelOutput);
            }
            // Async toModelOutput is not supported on the replay path (we're
            // sync here). Fall through to the raw-JSON fallback below rather
            // than blocking. Every in-tree toModelOutput is sync today.
            logger.log(
                "[stream] toolResultOutputFromInvocation skipped async toModelOutput",
                { tool: invocation.tool_name }
            );
        } catch (error) {
            logger.error(
                "[stream] toModelOutput threw during replay; falling back to raw JSON",
                { tool: invocation.tool_name },
                error
            );
        }
    }

    if (typeof output === "string") {
        return { type: "text", value: output };
    }
    // output was originally produced by JSON.stringify and read back via
    // JSON.parse, so it's a pure JSON value. Cast to satisfy the SDK's
    // strict JSONValue constraint without re-validating every key.
    return { type: "json", value: output as SdkToolResultOutput extends { type: "json"; value: infer V } ? V : never };
}

function buildAssistantMessagesForTurn(
    text: string,
    invocations: ToolInvocation[]
): ModelMessage[] {
    if (invocations.length === 0) {
        return text.length > 0
            ? [{ role: "assistant", content: text }]
            : [];
    }

    // The DB stores every tool call and the final text under a single
    // assistant message. The OpenAI Responses API (and the AI SDK) expect
    // the replayed conversation to look like:
    //   assistant -> [tool-call...]    // the model decided to call tools
    //   tool      -> [tool-result...]  // the tools' outputs
    //   assistant -> final text        // the model's final reply (optional)
    // We collapse potentially multiple tool-calling rounds into one
    // assistant+tool pair because the per-round granularity is not stored.
    // This still gives the model full evidence of every tool call and its
    // output so it doesn't "forget" work it did on a previous turn.
    const toolCallParts: SdkToolCallPart[] = invocations.map((inv) => ({
        type: "tool-call",
        toolCallId: inv.id,
        toolName: inv.tool_name,
        input: inv.input ?? {}
    }));

    const toolResultParts: SdkToolResultPart[] = invocations.map((inv) => ({
        type: "tool-result",
        toolCallId: inv.id,
        toolName: inv.tool_name,
        output: toolResultOutputFromInvocation(inv)
    }));

    const messages: ModelMessage[] = [
        { role: "assistant", content: toolCallParts },
        { role: "tool", content: toolResultParts }
    ];

    if (text.length > 0) {
        messages.push({ role: "assistant", content: text });
    }

    return messages;
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

    const assistantMessageIds = messages
        .filter((m) => m.role === "assistant")
        .map((m) => m.id);

    const invocationsByMessage = loadToolInvocationsByMessage(
        workspaceId,
        assistantMessageIds
    );

    for (const msg of messages) {
        if (msg.role === "assistant") {
            const invocations = invocationsByMessage.get(msg.id) ?? [];
            const assistantMessages = buildAssistantMessagesForTurn(
                msg.content,
                invocations
            );
            for (const produced of assistantMessages) {
                result.push(produced);
            }
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

        const hasAttachments =
            (attachmentsByMessage.get(msg.id)?.length ?? 0) > 0;

        const mentions = parseMentionsFromContent(msg.content);
        const mentionBlock = buildMentionsInstructionBlock(mentions);
        const userText =
            mentionBlock.length > 0
                ? `${mentionBlock}\n\n${msg.content}`
                : msg.content;

        if (!hasAttachments) {
            result.push({ role: "user", content: userText });
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
        if (userText.length > 0) {
            textSegments.push(userText);
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
                content: combinedText.length > 0 ? combinedText : userText
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

function isAgenticMode(value: unknown): value is AgenticMode {
    return value === "agent" || value === "plan";
}

interface SubagentOverrides {
    subagentType: SubagentType;
    parentConversationId: string | null;
    modelOverride?: string;
    reasoningEffortOverride?: ReasoningEffort | null;
}

function resolveConversationModelSettings(
    workspaceId: string,
    conversationId: string,
    subagentOverrides?: SubagentOverrides
): {
    modelName: string;
    reasoningEffort: ReasoningEffort | null;
    fastMode: boolean;
    permissionMode: PermissionMode;
    agenticMode: AgenticMode;
} {
    const state = getEffectiveConversationState(
        workspaceId,
        conversationId
    ).merged;

    // Subagent path: the conversation is a spawned child. Resolution order:
    //   1. Explicit override on the task-tool call (modelOverride).
    //   2. Parent conversation's `subagentModel` / `subagentReasoningEffort`
    //      state keys (set via ModelSelector's "Subagent model" section).
    //   3. Hard-coded defaults (gpt-5.4-mini + high).
    // Permission + agentic mode always come from the subagent's OWN row;
    // subagents run in `agent` mode regardless of parent mode (enforced at
    // spawn time, see runSubagent / permissions docs).
    if (subagentOverrides) {
        const parentState =
            subagentOverrides.parentConversationId
                ? getEffectiveConversationState(
                      workspaceId,
                      subagentOverrides.parentConversationId
                  ).merged
                : {};
        const parentSubagentModel =
            typeof parentState.subagentModel === "string"
                ? parentState.subagentModel.trim()
                : "";
        const parentSubagentEffort = parentState.subagentReasoningEffort;

        const resolvedModelName =
            subagentOverrides.modelOverride?.trim() ||
            (parentSubagentModel.length > 0
                ? parentSubagentModel
                : DEFAULT_SUBAGENT_MODEL);
        const model = getModelById(resolvedModelName);

        const rawEffort =
            subagentOverrides.reasoningEffortOverride !== undefined
                ? subagentOverrides.reasoningEffortOverride
                : parentSubagentEffort !== undefined
                  ? parentSubagentEffort
                  : DEFAULT_SUBAGENT_REASONING_EFFORT;
        const reasoningEffort =
            isReasoningEffort(rawEffort) &&
            model?.supportsReasoningEffort === true &&
            model.allowedEfforts.includes(rawEffort)
                ? rawEffort
                : (model?.defaultEffort ?? null);

        return {
            modelName: resolvedModelName,
            reasoningEffort,
            fastMode:
                state.fastMode === true && model?.supportsFastMode === true,
            permissionMode: isPermissionMode(state.permissionMode)
                ? state.permissionMode
                : "ask",
            agenticMode: "agent"
        };
    }

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

    const rawEffort = Object.prototype.hasOwnProperty.call(
        state,
        "reasoningEffort"
    )
        ? state.reasoningEffort
        : (state.effort ?? state.reasoning ?? null);
    const reasoningEffort =
        isReasoningEffort(rawEffort) &&
        model?.supportsReasoningEffort === true &&
        model.allowedEfforts.includes(rawEffort)
            ? rawEffort
            : (model?.defaultEffort ?? null);

    const permissionMode = isPermissionMode(state.permissionMode)
        ? state.permissionMode
        : "ask";

    const agenticMode = isAgenticMode(state.agenticMode)
        ? state.agenticMode
        : "agent";

    return {
        modelName,
        reasoningEffort,
        fastMode: state.fastMode === true && model?.supportsFastMode === true,
        permissionMode,
        agenticMode
    };
}

function safeStringify(value: unknown): string {
    try {
        return JSON.stringify(value);
    } catch {
        return JSON.stringify(String(value));
    }
}

/**
 * Mid-turn context-window trimming.
 *
 * `compactConversation` only runs *between* user turns: it summarizes
 * messages already persisted in the DB. But a single assistant turn can
 * accumulate hundreds of kilobytes of tool output (read_file, grep, etc.)
 * inside `streamText`'s tool loop, and those live entirely in memory
 * until the turn finishes. Without intervention, the loop happily keeps
 * sending the entire growing transcript to the model on every step until
 * we cross the model's hard context limit and crash the turn.
 *
 * The helper below is wired into `streamText`'s `prepareStep` callback.
 * On each step it estimates the token budget of the messages array and,
 * if we're over budget, replaces the oldest oversized tool-result
 * outputs with a short placeholder ("[Output truncated mid-turn …]").
 * Trimming preserves `toolCallId`/`toolName` so the SDK still pairs the
 * tool-call with its result — the model just sees a shorter result.
 *
 * The closure-scoped `Set<string>` of trimmed `toolCallId`s makes the
 * trim sticky: once a tool-result is shrunk on step N, it stays shrunk
 * for steps N+1, N+2, … so we don't re-grow into overflow.
 */

/**
 * Tool-results smaller than this character count are never trimmed.
 * Small results (search hits, brief errors) are usually still useful as
 * context, and trimming them yields little token savings.
 */
const TOOL_RESULT_TRIM_AT_CHARS = 4000;

/** Coarse chars→tokens ratio for fast budget estimation. */
const CHARS_PER_TOKEN_ESTIMATE = 4;

function estimateMessageChars(msg: SdkModelMessage): number {
    const content = msg.content as unknown;
    if (typeof content === "string") return content.length;
    if (!Array.isArray(content)) return 0;
    let total = 0;
    for (const part of content) {
        if (!part || typeof part !== "object") continue;
        const p = part as unknown as Record<string, unknown>;
        if (typeof p.text === "string") total += p.text.length;
        if (p.type === "tool-result") {
            const out = p.output as { type?: string; value?: unknown };
            if (out?.type === "text" && typeof out.value === "string") {
                total += out.value.length;
            } else if (out?.type === "json") {
                try {
                    total += JSON.stringify(out.value ?? "").length;
                } catch {
                    // ignore unstringifiable
                }
            }
        }
        if (p.type === "tool-call" && typeof p.input !== "undefined") {
            try {
                total += JSON.stringify(p.input).length;
            } catch {
                // ignore
            }
        }
    }
    return total;
}

function makeTrimmedToolResultPart(
    part: SdkToolResultPart,
    originalChars: number
): SdkToolResultPart {
    const placeholder: SdkToolResultOutput = {
        type: "text",
        value: `[Output trimmed mid-turn to fit context window. Original length: ${originalChars} chars. Re-run the tool if you still need this content.]`
    };
    return {
        ...part,
        output: placeholder
    };
}

function trimOversizedToolResultsForStep(
    messages: SdkModelMessage[],
    options: {
        budgetTokens: number;
        trimmedToolCallIds: Set<string>;
        onNewTrim?: (info: { newCount: number; totalCount: number }) => void;
    }
): SdkModelMessage[] | undefined {
    const { budgetTokens, trimmedToolCallIds, onNewTrim } = options;

    const initialChars = messages.reduce(
        (sum, msg) => sum + estimateMessageChars(msg),
        0
    );
    const estTokens = Math.ceil(initialChars / CHARS_PER_TOKEN_ESTIMATE);

    // No trimming ever needed AND nothing previously trimmed → fast-path.
    if (estTokens <= budgetTokens && trimmedToolCallIds.size === 0) {
        return undefined;
    }

    // Collect every trim-eligible tool-result, oldest first. Each entry
    // carries its (msgIdx, partIdx) so we can rewrite the right part of
    // the cloned messages array below.
    type Eligible = {
        msgIdx: number;
        partIdx: number;
        toolCallId: string;
        outputChars: number;
    };
    const eligible: Eligible[] = [];
    messages.forEach((msg, i) => {
        if (msg.role !== "tool") return;
        const content = msg.content;
        if (!Array.isArray(content)) return;
        content.forEach((rawPart, j) => {
            const part = rawPart as unknown as Record<string, unknown>;
            if (part?.type !== "tool-result") return;
            const toolCallId =
                typeof part.toolCallId === "string" ? part.toolCallId : "";
            if (!toolCallId) return;
            const out = part.output as { type?: string; value?: unknown };
            let outputChars = 0;
            if (out?.type === "text" && typeof out.value === "string") {
                outputChars = out.value.length;
            } else if (out?.type === "json") {
                try {
                    outputChars = JSON.stringify(out.value ?? "").length;
                } catch {
                    return;
                }
            } else {
                return;
            }
            if (
                outputChars < TOOL_RESULT_TRIM_AT_CHARS &&
                !trimmedToolCallIds.has(toolCallId)
            ) {
                return;
            }
            eligible.push({
                msgIdx: i,
                partIdx: j,
                toolCallId,
                outputChars
            });
        });
    });

    if (eligible.length === 0) return undefined;

    // Clone tool messages whose content arrays we need to mutate.
    const cloned: SdkModelMessage[] = messages.map((msg) => {
        if (msg.role !== "tool" || !Array.isArray(msg.content)) return msg;
        return {
            ...msg,
            content: [...msg.content]
        } as SdkModelMessage;
    });

    let savedChars = 0;
    let newTrims = 0;

    // Pass 1: re-apply every previously-trimmed tool-result. The SDK
    // builds `stepInputMessages` fresh each step from the original
    // (untrimmed) response messages it tracks internally, so we have
    // to re-trim every step or the trims would silently regrow.
    for (const entry of eligible) {
        if (!trimmedToolCallIds.has(entry.toolCallId)) continue;
        const msg = cloned[entry.msgIdx]!;
        const content = msg.content as unknown[];
        const part = content[entry.partIdx] as SdkToolResultPart;
        if (part?.type !== "tool-result") continue;
        const trimmed = makeTrimmedToolResultPart(part, entry.outputChars);
        content[entry.partIdx] = trimmed;
        const newChars = (
            (trimmed.output as { type: string; value: string }).value || ""
        ).length;
        savedChars += entry.outputChars - newChars;
    }

    // Pass 2: if still over budget, walk oldest-first and trim more.
    let remaining = initialChars - savedChars;
    let runningTokens = Math.ceil(remaining / CHARS_PER_TOKEN_ESTIMATE);
    if (runningTokens > budgetTokens) {
        for (const entry of eligible) {
            if (runningTokens <= budgetTokens) break;
            if (trimmedToolCallIds.has(entry.toolCallId)) continue;
            const msg = cloned[entry.msgIdx]!;
            const content = msg.content as unknown[];
            const part = content[entry.partIdx] as SdkToolResultPart;
            if (part?.type !== "tool-result") continue;
            const trimmed = makeTrimmedToolResultPart(part, entry.outputChars);
            content[entry.partIdx] = trimmed;
            trimmedToolCallIds.add(entry.toolCallId);
            newTrims += 1;
            const newChars = (
                (trimmed.output as { type: string; value: string }).value || ""
            ).length;
            const delta = entry.outputChars - newChars;
            savedChars += delta;
            remaining -= delta;
            runningTokens = Math.ceil(remaining / CHARS_PER_TOKEN_ESTIMATE);
        }
    }

    if (newTrims > 0 && onNewTrim) {
        onNewTrim({ newCount: newTrims, totalCount: trimmedToolCallIds.size });
    }

    if (newTrims === 0 && savedChars === 0) return undefined;

    return cloned;
}

/**
 * Read the `use_skill_names` JSON column off the most recently-created user
 * message in this conversation. Used by `streamReplyToLastMessage` to recover
 * the slash-command skills the user requested when they sent the message
 * (the create-conversation -> /reply path doesn't pass them as args).
 *
 * Returns an empty array when the column is NULL, malformed, or contains
 * something other than a string array.
 */
function readSkillNamesFromLatestUserMessage(
    db: ReturnType<typeof getWorkspaceDb>,
    conversationId: string
): string[] {
    interface Row {
        use_skill_names: string | null;
    }
    const row = db
        .query(
            "SELECT use_skill_names FROM messages WHERE conversation_id = ? AND role = 'user' ORDER BY created_at DESC LIMIT 1"
        )
        .get(conversationId) as Row | null;
    if (!row || !row.use_skill_names) return [];
    try {
        const parsed = JSON.parse(row.use_skill_names);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((x): x is string => typeof x === "string");
    } catch {
        return [];
    }
}

async function runStreamTextIntoController({
    controller,
    workspaceId,
    conversationId,
    assistantMsgId,
    assistantCreatedAt,
    modelMessages,
    abortSignal,
    subagentOverrides,
    useSkillNames
}: {
    controller: SseStreamController;
    workspaceId: string;
    conversationId: string;
    assistantMsgId: string;
    assistantCreatedAt: string;
    modelMessages: ModelMessage[];
    abortSignal?: AbortSignal;
    subagentOverrides?: SubagentOverrides;
    /**
     * Optional list of skill names the user requested for THIS turn via a
     * leading `/<skill-name>` slash command. The matched skills' `SKILL.md`
     * bodies are appended as a single trailing `role: "system"` message
     * after `modelMessages`. Cache-safe — see the caching comment around
     * `instructions` below.
     */
    useSkillNames?: string[];
}): Promise<void> {
    const db = getWorkspaceDb(workspaceId);
    const { modelName, reasoningEffort, fastMode, permissionMode, agenticMode } =
        resolveConversationModelSettings(
            workspaceId,
            conversationId,
            subagentOverrides
        );

    // Mid-turn trim budget. We use the resolved model's context window
    // and trim oversized tool-result outputs whenever the in-flight
    // tool loop's messages would exceed COMPACT_THRESHOLD of it. Closure
    // state below keeps the trim sticky across steps. See the comment
    // above `trimOversizedToolResultsForStep` for the rationale.
    const resolvedModelEntry = getModelById(modelName);
    const midTurnContextWindow = resolvedModelEntry?.contextWindow ?? 0;
    const midTurnBudgetTokens =
        midTurnContextWindow > 0
            ? Math.floor(midTurnContextWindow * COMPACT_THRESHOLD)
            : 0;
    const trimmedToolCallIds = new Set<string>();
    let midTurnTrimEventEmitted = false;

    // Persist the resolved model on the assistant placeholder row so the
    // global stats aggregator can count "favorite model" per-turn. Placeholder
    // inserts happen before model resolution, so patch it here.
    try {
        db.query("UPDATE messages SET model_id = ? WHERE id = ?").run(
            modelName,
            assistantMsgId
        );
    } catch (error) {
        logger.error(
            "[stream] Failed to record model_id on assistant message",
            { assistantMsgId, modelName },
            error
        );
    }

    // Let the client render the model label in the assistant message footer
    // as soon as it's resolved (instead of waiting for `finish` / `abort`).
    controller.enqueue(
        sseEvent("assistant-model", {
            messageId: assistantMsgId,
            modelId: modelName
        })
    );

    // Generation duration tracking. Measures wall-clock spent in the
    // streamText run, but *excludes* periods where the stream is blocked
    // waiting for the user (pending permission prompts or agent questions).
    // The accumulated paused time is a union across both blocker sources:
    // we only run the pause clock while at least one blocker is pending,
    // and stop it once every blocker has resolved. Persisted to
    // `messages.generation_duration_ms` on both `finish` and `abort`.
    const genStartMs = Date.now();
    let pendingBlockerCount = 0;
    let pauseStartedAtMs: number | null = null;
    let accumulatedPausedMs = 0;

    function beginBlocker(): void {
        pendingBlockerCount += 1;
        if (pendingBlockerCount === 1) {
            pauseStartedAtMs = Date.now();
        }
    }

    function endBlocker(): void {
        if (pendingBlockerCount === 0) return;
        pendingBlockerCount -= 1;
        if (pendingBlockerCount === 0 && pauseStartedAtMs !== null) {
            accumulatedPausedMs += Date.now() - pauseStartedAtMs;
            pauseStartedAtMs = null;
        }
    }

    function computeGenerationDurationMs(): number {
        let paused = accumulatedPausedMs;
        if (pauseStartedAtMs !== null) {
            paused += Date.now() - pauseStartedAtMs;
        }
        return Math.max(0, Date.now() - genStartMs - paused);
    }

    function persistGenerationDuration(durationMs: number): void {
        try {
            db.query(
                "UPDATE messages SET generation_duration_ms = ? WHERE id = ?"
            ).run(durationMs, assistantMsgId);
        } catch (error) {
            logger.error(
                "[stream] Failed to record generation_duration_ms",
                { assistantMsgId },
                error
            );
        }
    }

    let fullText = "";
    const reasoningParts: StreamReasoningPart[] = [];
    let currentReasoningPart: StreamReasoningPart | null = null;
    let nextMessageSeq = 0;

    // Tracks tool calls that started streaming their input but haven't yet
    // produced a finalized `tool-call` event. We pre-allocate an invocation
    // id + message seq at `tool-input-start` so the client can render a
    // pending card immediately and the eventual `tool-call` event lands on
    // the same row instead of creating a duplicate. Keyed by the SDK's
    // tool call id (`part.id` for input-* events, `part.toolCallId` for
    // `tool-call`).
    const pendingToolCallIds = new Map<
        string,
        { invocationId: string; messageSeq: number; createdAt: string }
    >();

    function allocateMessageSeq(): number {
        const seq = nextMessageSeq;
        nextMessageSeq += 1;
        return seq;
    }

    function insertReasoningPart(part: StreamReasoningPart) {
        db.query(
            "INSERT INTO message_reasoning_parts (id, message_id, text, started_at, ended_at, sort_index, message_seq) VALUES (?, ?, ?, ?, ?, ?, ?)"
        ).run(
            part.id,
            assistantMsgId,
            part.text,
            part.startedAt,
            part.endedAt,
            part.sortIndex,
            part.messageSeq
        );
    }

    function updateReasoningPart(part: StreamReasoningPart) {
        db.query(
            "UPDATE message_reasoning_parts SET text = ?, ended_at = ? WHERE id = ?"
        ).run(part.text, part.endedAt, part.id);
    }

    function collapseLegacyReasoning(): {
        text: string | null;
        startedAt: string | null;
        endedAt: string | null;
    } {
        const withText = reasoningParts.filter((part) => part.text.length > 0);
        if (withText.length === 0) {
            return { text: null, startedAt: null, endedAt: null };
        }
        const text = withText.map((part) => part.text).join("\n\n");
        const startedAt = withText[0]?.startedAt ?? null;
        const endedAt =
            [...withText].reverse().find((part) => part.endedAt)?.endedAt ??
            null;
        return { text, startedAt, endedAt };
    }

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
                beginBlocker();
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

            endBlocker();
            controller.enqueue(
                sseEvent("permission-resolved", {
                    id: event.requestId,
                    messageId: assistantMsgId,
                    decision: event.decision
                })
            );
        }
    );

    const unsubscribeTodos = subscribeToTodos(conversationId, (event) => {
        controller.enqueue(
            sseEvent("todos-updated", {
                conversation_id: event.conversationId,
                todos: event.todos
            })
        );
    });

    const unsubscribeShellProgress = subscribeToShellProgress(
        conversationId,
        (event) => {
            controller.enqueue(
                sseEvent("tool-progress", {
                    id: event.id,
                    messageId: event.message_id,
                    task_id: event.task_id,
                    stream: event.stream,
                    chunk: event.chunk,
                    at: event.at
                })
            );
        }
    );

    const unsubscribeShellLifecycle = subscribeToShellLifecycle(
        conversationId,
        (event) => {
            controller.enqueue(
                sseEvent("tool-lifecycle", {
                    id: event.id,
                    messageId: event.message_id,
                    task_id: event.task_id,
                    type: event.type,
                    state: event.state,
                    exit_code: event.exit_code,
                    ended_at: event.ended_at
                })
            );
        }
    );

    const unsubscribeQuestions = subscribeToQuestions(
        conversationId,
        (event) => {
            if (event.type === "requested") {
                beginBlocker();
                controller.enqueue(
                    sseEvent("questions-required", {
                        id: event.request.id,
                        messageId: assistantMsgId,
                        questions: event.request.questions,
                        createdAt: event.request.createdAt
                    })
                );
                return;
            }

            endBlocker();
            controller.enqueue(
                sseEvent("questions-resolved", {
                    id: event.requestId,
                    messageId: assistantMsgId,
                    answers: event.answers,
                    cancelled: event.cancelled
                })
            );
        }
    );

    const unsubscribePlans = subscribeToPlanUpdates(
        conversationId,
        (event) => {
            controller.enqueue(
                sseEvent("plan-updated", {
                    conversation_id: event.conversationId,
                    plan: {
                        id: event.plan.id,
                        title: event.plan.title,
                        content: event.plan.content,
                        todos: event.plan.todos,
                        filePath: event.plan.file_path,
                        createdAt: event.plan.created_at,
                        updatedAt: event.plan.updated_at
                    }
                })
            );
        }
    );

    // Only the parent (non-subagent) cares about its children's lifecycle
    // events. Forward them so the frontend can render a TaskBlock that
    // flips to `done` + shows the final text once the subagent finishes.
    const unsubscribeSubagents = subagentOverrides
        ? () => {}
        : subscribeToSubagentLifecycle((event) => {
              if (event.type === "started") {
                  if (event.parentConversationId !== conversationId) return;
                  controller.enqueue(
                      sseEvent("subagent-started", {
                          parent_conversation_id: event.parentConversationId,
                          messageId: assistantMsgId,
                          subagent: event.subagent
                      })
                  );
                  return;
              }
              if (event.parentConversationId !== conversationId) return;
              controller.enqueue(
                  sseEvent("subagent-finished", {
                      parent_conversation_id: event.parentConversationId,
                      messageId: assistantMsgId,
                      subagent_id: event.subagentId,
                      outcome: event.outcome,
                      final_text: event.finalText,
                      error: event.error,
                      ended_at: event.endedAt
                  })
              );
          });

    try {
        // Streaming runs over a per-conversation WebSocket session that
        // sends incremental input + `previous_response_id` instead of the
        // full history every turn — matching the official Codex CLI's
        // billing posture. The session falls back transparently to HTTP if
        // the WS handshake fails. See codex-websocket-provider.ts.
        const model = await createCodexWsModel({
            conversationId,
            modelName,
            isSubagent: Boolean(subagentOverrides),
            parentConversationId:
                subagentOverrides?.parentConversationId ?? null
        });
        const prompt = buildConversationPrompt({
            workspaceId,
            conversationId,
            agenticMode,
            modelName
        });
        const skills = prompt.skills.skills;
        const subagentPromptAddition = subagentOverrides
            ? getSubagentTypeConfig(subagentOverrides.subagentType)
                  .systemPromptAddition
            : "";
        const instructions = prompt.prompt + subagentPromptAddition;

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
            permissionMode,
            "agenticMode:",
            agenticMode
        );

        // Caching strategy mirrors the real Codex CLI
        // (see codex-rs/core/src/client.rs build_responses_request):
        // - `instructions` is kept bit-identical across turns for the same
        //   conversation (volatile content like the current todos list is
        //   injected as a trailing input item instead, see below).
        // - `prompt_cache_key` is the conversation id so every turn lands on
        //   the same cache node.
        // - `prompt_cache_retention` is intentionally NOT sent: the ChatGPT
        //   backend (chatgpt.com/backend-api/codex/responses) returns 400
        //   "Unsupported parameter: prompt_cache_retention" — that option
        //   only exists on the direct OpenAI Platform API. The Codex CLI
        //   itself doesn't set it either; retention is handled server-side.
        // - `store: false` matches the ChatGPT-auth backend; the AI SDK
        //   automatically adds `include: ["reasoning.encrypted_content"]` in
        //   that case for reasoning models so multi-step tool loops keep
        //   reasoning context within a turn.
        const openaiOptions: Record<string, string | boolean | undefined> = {
            instructions,
            store: false,
            promptCacheKey: conversationId,
            serviceTier: fastMode ? "priority" : undefined
        };

        if (reasoningEffort && reasoningEffort !== "none") {
            openaiOptions.reasoningEffort = reasoningEffort;
            openaiOptions.reasoningSummary = "detailed";
        }

        let workspacePath: string | undefined;
        try {
            workspacePath = getWorkspace(workspaceId).path;
        } catch {
            // workspace may not exist; tools will reject relative paths
        }

        const tools = buildConversationTools({
            conversationId,
            workspaceId,
            workspacePath,
            getSkills: () => skills,
            getAssistantMessageId: () => assistantMsgId,
            subagentType: subagentOverrides?.subagentType,
            getParentAbortSignal: () => abortSignal,
            getMode: () => {
                try {
                    return resolveConversationModelSettings(
                        workspaceId,
                        conversationId,
                        subagentOverrides
                    ).permissionMode;
                } catch (error) {
                    logger.error(
                        "[stream] failed to resolve permission mode, falling back",
                        error
                    );
                    return permissionMode;
                }
            },
            getAgenticMode: () => {
                try {
                    return resolveConversationModelSettings(
                        workspaceId,
                        conversationId,
                        subagentOverrides
                    ).agenticMode;
                } catch (error) {
                    logger.error(
                        "[stream] failed to resolve agentic mode, falling back",
                        error
                    );
                    return agenticMode;
                }
            }
        });

        // Inject the current todos as a trailing system message instead of
        // folding them into `instructions`. The Codex CLI uses the same
        // pattern (settings-update + env-context messages appended at the
        // end of `input`) so the cached prefix of the conversation stays
        // identical from one turn to the next; the todos list can change
        // every turn without busting the cache of the big system prompt,
        // repo instructions, skills catalog, and earlier chat history.
        let modelMessagesWithTodos =
            prompt.todosBlock.length > 0
                ? [
                      ...modelMessages,
                      {
                          role: "system" as const,
                          content: prompt.todosBlock
                      }
                  ]
                : modelMessages;

        // Resolve the slash-command-requested skills against the workspace's
        // discovered skills catalog and append their full SKILL.md bodies
        // as a SECOND trailing `role: "system"` message. Like the todos
        // block, this is intentionally NOT folded into the cached
        // `instructions` blob — it's per-turn data and would otherwise
        // break the conversation-level prompt cache the moment the user
        // toggles between different `/<skill>` commands across turns.
        const requestedSkills: Skill[] = (useSkillNames ?? [])
            .map((name) => findSkill(name, skills))
            .filter((s): s is Skill => Boolean(s));
        if (requestedSkills.length > 0) {
            const activeSkillsBlock = buildActiveSkillsBlock(requestedSkills);
            if (activeSkillsBlock.length > 0) {
                modelMessagesWithTodos = [
                    ...modelMessagesWithTodos,
                    {
                        role: "system" as const,
                        content: activeSkillsBlock
                    }
                ];
            }
            logger.log("[stream] Injected active skills for turn", {
                conversationId,
                requested: useSkillNames,
                resolved: requestedSkills.map((s) => s.name)
            });

            // Surface the auto-loaded skills in the chat UI by emitting a
            // synthetic `use_skill` tool invocation per skill before the
            // assistant text streams in. The DB row + SSE pair mirror what
            // the LLM itself would produce if it had called `use_skill`,
            // so the existing ToolCallCard renderer picks them up without
            // any frontend changes. We mark the row `success` immediately
            // — there's nothing to await; the playbook is already in the
            // system prompt above.
            for (const skill of requestedSkills) {
                const invocationId = crypto.randomUUID();
                const messageSeq = allocateMessageSeq();
                const createdAt = new Date().toISOString();
                const toolCallId = `slash-${invocationId}`;

                let files: string[] = [];
                try {
                    files = await listSkillFiles(skill);
                } catch (error) {
                    logger.error(
                        "[stream] Failed to list files for slash-loaded skill",
                        { skill: skill.name },
                        error
                    );
                }

                const input = { name: skill.name };
                const output = {
                    ok: true as const,
                    name: skill.name,
                    description: skill.description,
                    source: skill.source,
                    directory: skill.directory,
                    content: skill.content,
                    files
                };

                db.query(
                    "INSERT INTO tool_invocations (id, message_id, tool_name, input_json, output_json, error, status, created_at, message_seq) VALUES (?, ?, 'use_skill', ?, ?, NULL, 'success', ?, ?)"
                ).run(
                    invocationId,
                    assistantMsgId,
                    safeStringify(input),
                    safeStringify(output),
                    createdAt,
                    messageSeq
                );

                controller.enqueue(
                    sseEvent("tool-call", {
                        id: invocationId,
                        messageId: assistantMsgId,
                        toolCallId,
                        toolName: "use_skill",
                        input,
                        status: "success" as const,
                        createdAt,
                        messageSeq
                    })
                );
                controller.enqueue(
                    sseEvent("tool-result", {
                        messageId: assistantMsgId,
                        toolCallId,
                        toolName: "use_skill",
                        output,
                        error: null,
                        status: "success" as const
                    })
                );
            }
        } else if (useSkillNames && useSkillNames.length > 0) {
            logger.log(
                "[stream] No skills resolved for slash-command request",
                { conversationId, requested: useSkillNames }
            );
        }

        const result = streamText({
            model,
            messages: modelMessagesWithTodos,
            tools,
            stopWhen: stepCountIs(Infinity),
            abortSignal,
            providerOptions: {
                openai: openaiOptions
            },
            // Mid-turn trim. Runs before EACH LLM step inside the tool
            // loop. If the in-flight messages would exceed our token
            // budget (COMPACT_THRESHOLD * model.contextWindow), we
            // replace the oldest oversized tool-result outputs with a
            // short placeholder. The trim is sticky via the closure-
            // scoped Set so prior trims persist across steps. We only
            // emit `mid-turn-trim-started` to the frontend the first
            // time it kicks in this turn — subsequent steps just keep
            // re-applying silently.
            prepareStep: ({ messages }) => {
                if (midTurnBudgetTokens <= 0) return undefined;
                const trimmed = trimOversizedToolResultsForStep(messages, {
                    budgetTokens: midTurnBudgetTokens,
                    trimmedToolCallIds,
                    onNewTrim: ({ newCount, totalCount }) => {
                        logger.log("[stream] Mid-turn tool-result trim", {
                            conversationId,
                            assistantMsgId,
                            newCount,
                            totalCount,
                            budgetTokens: midTurnBudgetTokens
                        });
                        if (!midTurnTrimEventEmitted) {
                            midTurnTrimEventEmitted = true;
                            controller.enqueue(
                                sseEvent("mid-turn-trim", {
                                    conversation_id: conversationId,
                                    message_id: assistantMsgId,
                                    trimmed_count: totalCount
                                })
                            );
                        }
                    }
                });
                if (!trimmed) return undefined;
                return { messages: trimmed };
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

                const legacy = collapseLegacyReasoning();
                db.query(
                    "UPDATE messages SET input_tokens = ?, output_tokens = ?, reasoning_tokens = ?, total_tokens = ?, reasoning_content = ?, reasoning_started_at = ?, reasoning_ended_at = ? WHERE id = ?"
                ).run(
                    input,
                    output,
                    reasoning,
                    total,
                    legacy.text,
                    legacy.startedAt,
                    legacy.endedAt,
                    assistantMsgId
                );

                // Record the assistant turn in the append-only stats ledger.
                // This is the authoritative point — `onFinish` fires once the
                // stream has final usage data + the resolved model is known,
                // and the row survives any later conversation deletion.
                recordStatAssistantMessage({
                    workspaceId,
                    conversationId,
                    messageId: assistantMsgId,
                    modelId: modelName,
                    inputTokens: input,
                    outputTokens: output,
                    reasoningTokens: reasoning,
                    totalTokens: total,
                    createdAt: assistantCreatedAt
                });
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
                const newPart: StreamReasoningPart = {
                    id: crypto.randomUUID(),
                    text: "",
                    startedAt: new Date().toISOString(),
                    endedAt: null,
                    sortIndex: reasoningParts.length,
                    messageSeq: allocateMessageSeq()
                };
                reasoningParts.push(newPart);
                currentReasoningPart = newPart;
                insertReasoningPart(newPart);
                controller.enqueue(
                    sseEvent("reasoning-start", {
                        messageId: assistantMsgId,
                        partId: newPart.id,
                        sortIndex: newPart.sortIndex,
                        messageSeq: newPart.messageSeq,
                        startedAt: newPart.startedAt
                    })
                );
                continue;
            }

            if (part.type === "reasoning-delta") {
                if (!currentReasoningPart) {
                    currentReasoningPart = {
                        id: crypto.randomUUID(),
                        text: "",
                        startedAt: new Date().toISOString(),
                        endedAt: null,
                        sortIndex: reasoningParts.length,
                        messageSeq: allocateMessageSeq()
                    };
                    reasoningParts.push(currentReasoningPart);
                    insertReasoningPart(currentReasoningPart);
                    controller.enqueue(
                        sseEvent("reasoning-start", {
                            messageId: assistantMsgId,
                            partId: currentReasoningPart.id,
                            sortIndex: currentReasoningPart.sortIndex,
                            messageSeq: currentReasoningPart.messageSeq,
                            startedAt: currentReasoningPart.startedAt
                        })
                    );
                }
                currentReasoningPart.text += part.text;
                updateReasoningPart(currentReasoningPart);
                controller.enqueue(
                    sseEvent("reasoning-delta", {
                        messageId: assistantMsgId,
                        partId: currentReasoningPart.id,
                        text: part.text
                    })
                );
                continue;
            }

            if (part.type === "reasoning-end") {
                const endedAt = new Date().toISOString();
                if (currentReasoningPart) {
                    currentReasoningPart.endedAt = endedAt;
                    updateReasoningPart(currentReasoningPart);
                    controller.enqueue(
                        sseEvent("reasoning-end", {
                            messageId: assistantMsgId,
                            partId: currentReasoningPart.id,
                            endedAt
                        })
                    );
                    currentReasoningPart = null;
                }
                continue;
            }

            if (part.type === "tool-input-start") {
                const invocationId = crypto.randomUUID();
                const createdAt = new Date().toISOString();
                const messageSeq = allocateMessageSeq();
                pendingToolCallIds.set(part.id, {
                    invocationId,
                    messageSeq,
                    createdAt
                });
                registerToolInvocationContext(part.id, {
                    invocationId,
                    conversationId,
                    workspaceId,
                    messageId: assistantMsgId
                });
                controller.enqueue(
                    sseEvent("tool-input-start", {
                        id: invocationId,
                        messageId: assistantMsgId,
                        toolCallId: part.id,
                        toolName: part.toolName,
                        status: "pending" as ToolInvocationStatus,
                        createdAt,
                        messageSeq
                    })
                );
                continue;
            }

            if (part.type === "tool-input-delta") {
                const pending = pendingToolCallIds.get(part.id);
                controller.enqueue(
                    sseEvent("tool-input-delta", {
                        id: pending?.invocationId,
                        messageId: assistantMsgId,
                        toolCallId: part.id,
                        delta: part.delta
                    })
                );
                continue;
            }

            if (part.type === "tool-input-end") {
                const pending = pendingToolCallIds.get(part.id);
                controller.enqueue(
                    sseEvent("tool-input-end", {
                        id: pending?.invocationId,
                        messageId: assistantMsgId,
                        toolCallId: part.id
                    })
                );
                continue;
            }

            if (part.type === "tool-call") {
                const pending = pendingToolCallIds.get(part.toolCallId);
                const invocationId =
                    pending?.invocationId ?? crypto.randomUUID();
                const createdAt =
                    pending?.createdAt ?? new Date().toISOString();
                const messageSeq =
                    pending?.messageSeq ?? allocateMessageSeq();
                if (pending) pendingToolCallIds.delete(part.toolCallId);
                registerToolInvocationContext(part.toolCallId, {
                    invocationId,
                    conversationId,
                    workspaceId,
                    messageId: assistantMsgId
                });

                const inputJson = safeStringify(part.input);
                const status: ToolInvocationStatus = "pending";

                db.query(
                    "INSERT INTO tool_invocations (id, message_id, tool_name, input_json, output_json, error, status, created_at, message_seq) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?)"
                ).run(
                    invocationId,
                    assistantMsgId,
                    part.toolName,
                    inputJson,
                    status,
                    createdAt,
                    messageSeq
                );

                controller.enqueue(
                    sseEvent("tool-call", {
                        id: invocationId,
                        messageId: assistantMsgId,
                        toolCallId: part.toolCallId,
                        toolName: part.toolName,
                        input: part.input,
                        status,
                        createdAt,
                        messageSeq
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

                unregisterToolInvocationContext(part.toolCallId);

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

                unregisterToolInvocationContext(part.toolCallId);

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
                abortQuestions(conversationId, "aborted");
                abortSubagentsForParent(conversationId, "parent-aborted");
                killForegroundForConversation(conversationId);
                markPendingToolInvocationsAsError(
                    db,
                    assistantMsgId,
                    "aborted"
                );
                if (currentReasoningPart && !currentReasoningPart.endedAt) {
                    currentReasoningPart.endedAt = new Date().toISOString();
                    updateReasoningPart(currentReasoningPart);
                    currentReasoningPart = null;
                }
                finalizeAbortedAssistantMessage(
                    db,
                    assistantMsgId,
                    conversationId,
                    fullText,
                    reasoningParts
                );
                const abortDurationMs = computeGenerationDurationMs();
                persistGenerationDuration(abortDurationMs);
                controller.enqueue(
                    sseEvent("abort", {
                        reason: part.reason ?? "aborted",
                        content: fullText,
                        assistantMessageId: assistantMsgId,
                        modelId: modelName,
                        generationDurationMs: abortDurationMs
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

        if (currentReasoningPart && !currentReasoningPart.endedAt) {
            currentReasoningPart.endedAt = new Date().toISOString();
            updateReasoningPart(currentReasoningPart);
            currentReasoningPart = null;
        }

        const legacy = collapseLegacyReasoning();
        db.query(
            "UPDATE messages SET content = ?, reasoning_content = ?, reasoning_started_at = ?, reasoning_ended_at = ? WHERE id = ?"
        ).run(
            fullText,
            legacy.text,
            legacy.startedAt,
            legacy.endedAt,
            assistantMsgId
        );
        db.query("UPDATE conversations SET updated_at = ? WHERE id = ?").run(
            new Date().toISOString(),
            conversationId
        );

        const finishDurationMs = computeGenerationDurationMs();
        persistGenerationDuration(finishDurationMs);

        controller.enqueue(
            sseEvent("finish", {
                reason: "stop",
                content: fullText,
                assistantMessageId: assistantMsgId,
                usage: lastUsage,
                modelId: modelName,
                generationDurationMs: finishDurationMs
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
            abortQuestions(conversationId, "aborted");
            abortSubagentsForParent(conversationId, "parent-aborted");
            killForegroundForConversation(conversationId);
            markPendingToolInvocationsAsError(db, assistantMsgId, "aborted");
            if (currentReasoningPart && !currentReasoningPart.endedAt) {
                currentReasoningPart.endedAt = new Date().toISOString();
                updateReasoningPart(currentReasoningPart);
                currentReasoningPart = null;
            }
            finalizeAbortedAssistantMessage(
                db,
                assistantMsgId,
                conversationId,
                fullText,
                reasoningParts
            );
            persistGenerationDuration(computeGenerationDurationMs());
            return;
        }

        const message =
            error instanceof Error ? error.message : "Stream failed";

        logger.error("[stream] Stream error:", error);

        abortPermissions(conversationId, message);
        abortQuestions(conversationId, message);
        abortSubagentsForParent(conversationId, message);
        killForegroundForConversation(conversationId);
        markPendingToolInvocationsAsError(db, assistantMsgId, message);
        db.query("DELETE FROM messages WHERE id = ?").run(assistantMsgId);
        controller.enqueue(sseEvent("error", { message }));
    } finally {
        unsubscribePermissions();
        unsubscribeQuestions();
        unsubscribeTodos();
        unsubscribeShellProgress();
        unsubscribeShellLifecycle();
        unsubscribePlans();
        unsubscribeSubagents();
    }
}

function conversationHasPlaceholderTitle(
    workspaceId: string,
    conversationId: string
): boolean {
    try {
        const db = getWorkspaceDb(workspaceId);
        const row = db
            .query("SELECT title FROM conversations WHERE id = ?")
            .get(conversationId) as { title: string } | null;
        return row?.title === DEFAULT_CONVERSATION_TITLE;
    } catch {
        return false;
    }
}

function startTitleGenerationForController({
    workspaceId,
    conversationId,
    controller
}: {
    workspaceId: string;
    conversationId: string;
    controller: SseStreamController;
}): void {
    if (!conversationHasPlaceholderTitle(workspaceId, conversationId)) {
        return;
    }

    void generateConversationTitleIfNeeded({
        workspaceId,
        conversationId,
        onTitle: (updated) => {
            try {
                controller.enqueue(
                    sseEvent("conversation-title", {
                        conversation_id: updated.id,
                        title: updated.title,
                        updated_at: updated.updated_at
                    })
                );
            } catch (error) {
                logger.error(
                    "[stream] Failed to enqueue conversation-title event",
                    { workspaceId, conversationId },
                    error
                );
            }
        }
    });
}

/**
 * Decide whether the conversation needs auto-compaction and, if so, run
 * `compactConversation` while emitting `compaction-started` /
 * `compacted` / `compaction-skipped` / `compaction-error` SSE events on
 * the given stream controller. Used by both `streamConversationReply`
 * (incoming user message) and `streamReplyToLastMessage` (first reply on
 * a freshly created conversation).
 *
 * `extraTokens` accounts for tokens that aren't yet in the DB — e.g. the
 * pending user message content + attachments in `streamConversationReply`'s
 * pre-stream check. When the user message is already persisted (the
 * `/reply` route) pass 0.
 *
 * Always returns void; callers query the DB after this resolves to pick
 * up the post-compaction state.
 */
async function runAutoCompactionForStream(
    workspaceId: string,
    conversationId: string,
    controller: SseStreamController,
    extraTokens: number = 0
): Promise<void> {
    let shouldCompact = false;
    try {
        const ctx = computeContextSummary(workspaceId, conversationId);
        if (ctx.contextWindow > 0) {
            const projected = ctx.usedTokens + extraTokens;
            if (projected / ctx.contextWindow > COMPACT_THRESHOLD) {
                shouldCompact = true;
                logger.log("[stream] Auto-compact threshold hit", {
                    used: ctx.usedTokens,
                    extra: extraTokens,
                    projected,
                    window: ctx.contextWindow,
                    threshold: COMPACT_THRESHOLD
                });
            }
        }
    } catch (error) {
        logger.error(
            "[stream] Pre-stream compaction check failed (continuing without compaction)",
            error
        );
    }

    if (!shouldCompact) return;

    controller.enqueue(
        sseEvent("compaction-started", {
            conversation_id: conversationId
        })
    );
    try {
        const outcome = await compactConversation(workspaceId, conversationId);
        if (outcome.summaryMessageId) {
            controller.enqueue(
                sseEvent("compacted", {
                    conversation_id: conversationId,
                    summaryMessageId: outcome.summaryMessageId,
                    summarizedMessageIds: outcome.summarizedMessageIds,
                    summarizedCount: outcome.summarizedCount,
                    usedTokensAfter: outcome.usedTokensAfter,
                    summaryContent: outcome.summaryContent,
                    summaryCreatedAt: outcome.summaryCreatedAt,
                    summaryOfUntil: outcome.summaryOfUntil
                })
            );
        } else {
            controller.enqueue(
                sseEvent("compaction-skipped", {
                    conversation_id: conversationId,
                    reason:
                        "reason" in outcome
                            ? outcome.reason
                            : "Nothing to summarize"
                })
            );
        }
    } catch (error) {
        logger.error(
            "[stream] Auto-compact failed (continuing without compaction)",
            error
        );
        controller.enqueue(
            sseEvent("compaction-error", {
                conversation_id: conversationId,
                error:
                    error instanceof Error
                        ? error.message
                        : "Compaction failed"
            })
        );
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

    return buildStreamResponse(async (rawController) => {
        const controller = wrapControllerWithBroadcast(
            rawController,
            conversationId
        );
        startTitleGenerationForController({
            workspaceId,
            conversationId,
            controller
        });

        // Run auto-compaction BEFORE loading the history / building model
        // messages so the model sees the compacted state. The user message
        // is already persisted by `createConversation`, so `extraTokens` is
        // 0 (everything is in the DB already). This is the same flow
        // `streamConversationReply` uses, just without the incoming-user-
        // content delta. Without this, the very first reply on a fresh
        // conversation could overflow the context window before any
        // compaction ever ran (the `/reply` route bypassed compaction
        // entirely until 2026-04-26).
        await runAutoCompactionForStream(
            workspaceId,
            conversationId,
            controller,
            0
        );

        const history = db
            .query(
                "SELECT id, conversation_id, role, content, created_at FROM messages WHERE conversation_id = ? AND compacted = 0 ORDER BY created_at ASC"
            )
            .all(conversationId) as Message[];

        logger.log("[stream] Loaded", history.length, "messages for context");

        const modelMessages = buildModelMessages(workspaceId, history);

        // Pull `use_skill_names` from the latest user message so slash-command
        // skills the user requested at conversation creation (home flow:
        // create -> /reply) carry into this reply. The column is JSON-encoded
        // and may be NULL for pre-feature rows or messages that didn't use
        // a slash command.
        const useSkillNames = readSkillNamesFromLatestUserMessage(
            db,
            conversationId
        );

        const assistantMsgId = crypto.randomUUID();
        const assistantCreatedAt = new Date().toISOString();

        db.query(
            "INSERT INTO messages (id, conversation_id, role, content, created_at, compacted) VALUES (?, ?, ?, ?, ?, 0)"
        ).run(
            assistantMsgId,
            conversationId,
            "assistant",
            "",
            assistantCreatedAt
        );

        logger.log(
            "[stream] Created assistant placeholder message:",
            assistantMsgId
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
            assistantCreatedAt,
            modelMessages,
            abortSignal,
            useSkillNames
        });
    });
}

export async function streamConversationReply(
    workspaceId: string,
    conversationId: string,
    userContent: string,
    abortSignal?: AbortSignal,
    attachmentIds: string[] = [],
    mentions: MessageMention[] = [],
    useSkillNames: string[] = []
): Promise<Response> {
    logger.log("[stream] streamConversationReply start", {
        workspaceId,
        conversationId,
        userContentLength: userContent.length,
        attachmentCount: attachmentIds.length,
        mentionCount: mentions.length,
        useSkillNames
    });

    const db = getWorkspaceDb(workspaceId);

    const existing = db
        .query("SELECT id FROM conversations WHERE id = ?")
        .get(conversationId);

    if (!existing) {
        logger.error("[stream] Conversation not found:", conversationId);
        throw new Error(`Conversation not found: ${conversationId}`);
    }

    return buildStreamResponse(async (rawController) => {
        const controller = wrapControllerWithBroadcast(
            rawController,
            conversationId
        );
        startTitleGenerationForController({
            workspaceId,
            conversationId,
            controller
        });

        // 1) Persist + emit the user message immediately so the UI shows
        //    feedback before the (potentially slow) summarization call.
        const userMsgId = crypto.randomUUID();
        const userCreatedAt = new Date().toISOString();
        // Persist requested-skill names on the user row so a future re-stream
        // (e.g. resumed-after-crash flows that read history from disk) can
        // recover them. The current path has them in scope already, so the
        // INSERT is mostly belt-and-braces.
        const skillNamesJson =
            useSkillNames.length > 0 ? JSON.stringify(useSkillNames) : null;

        db.query(
            "INSERT INTO messages (id, conversation_id, role, content, created_at, compacted, use_skill_names) VALUES (?, ?, ?, ?, ?, 0, ?)"
        ).run(
            userMsgId,
            conversationId,
            "user",
            userContent,
            userCreatedAt,
            skillNamesJson
        );

        db.query("UPDATE conversations SET updated_at = ? WHERE id = ?").run(
            userCreatedAt,
            conversationId
        );

        recordStatUserMessage({
            workspaceId,
            conversationId,
            messageId: userMsgId,
            createdAt: userCreatedAt
        });

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

        controller.enqueue(
            sseEvent("user-message", {
                id: userMsgId,
                role: "user" as const,
                content: userContent,
                conversation_id: conversationId,
                created_at: userCreatedAt,
                attachments: linkedAttachments
            })
        );

        // 2) Run compaction if needed. The just-inserted user message is
        //    automatically part of the kept window (it is the latest row),
        //    so it never gets summarized away. The helper emits the SSE
        //    progress markers (`compaction-started` →
        //    `compacted`/`compaction-skipped`/`compaction-error`) so the
        //    frontend renders the "Chat context summarized" marker the
        //    moment the summary is ready. `extraTokens` was 0-here, but
        //    the user message is now in the DB so it's already counted
        //    by `computeContextSummary` inside the helper.
        await runAutoCompactionForStream(
            workspaceId,
            conversationId,
            controller,
            0
        );

        // 3) Build the model context AFTER compaction so the prompt reflects
        //    the new (smaller) conversation state. Filtering on `compacted=0`
        //    drops the rows that were just marked compacted and keeps the
        //    summary system row that compactConversation inserted.
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

        const modelMessages = buildModelMessages(workspaceId, history);

        // 4) Insert the assistant placeholder and emit assistant-start.
        const assistantMsgId = crypto.randomUUID();
        const assistantCreatedAt = new Date().toISOString();

        db.query(
            "INSERT INTO messages (id, conversation_id, role, content, created_at, compacted) VALUES (?, ?, ?, ?, ?, 0)"
        ).run(
            assistantMsgId,
            conversationId,
            "assistant",
            "",
            assistantCreatedAt
        );

        logger.log("[stream] Created assistant placeholder:", assistantMsgId);

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
            assistantCreatedAt,
            modelMessages,
            abortSignal,
            useSkillNames
        });
    });
}

/**
 * Drive a subagent stream to completion. The parent `task` tool calls this
 * and awaits the returned promise; when it resolves, the parent receives
 * the subagent's final assistant text as the tool result.
 *
 * Unlike `streamReplyToLastMessage`, this does NOT return an HTTP Response.
 * All SSE events are published through the per-conversation broadcaster
 * (conversation-events.ts), so the subagent page in the UI can attach via
 * `GET /conversations/:id/events` and watch the stream live — but there's
 * no primary HTTP client reading the stream here.
 */
export async function runSubagentStream(params: {
    workspaceId: string;
    conversationId: string;
    abortSignal: AbortSignal;
    subagentType: SubagentType;
    modelOverride?: string;
    reasoningEffortOverride?: ReasoningEffort | null;
}): Promise<{ finalText: string; aborted: boolean }> {
    const {
        workspaceId,
        conversationId,
        abortSignal,
        subagentType,
        modelOverride,
        reasoningEffortOverride
    } = params;

    const db = getWorkspaceDb(workspaceId);

    interface ParentRow {
        parent_conversation_id: string | null;
    }
    const parentRow = db
        .query(
            "SELECT parent_conversation_id FROM conversations WHERE id = ?"
        )
        .get(conversationId) as ParentRow | null;
    const parentConversationId = parentRow?.parent_conversation_id ?? null;

    const history = db
        .query(
            "SELECT id, conversation_id, role, content, created_at FROM messages WHERE conversation_id = ? AND compacted = 0 ORDER BY created_at ASC"
        )
        .all(conversationId) as Message[];

    const modelMessages = buildModelMessages(workspaceId, history);

    const assistantMsgId = crypto.randomUUID();
    const assistantCreatedAt = new Date().toISOString();
    db.query(
        "INSERT INTO messages (id, conversation_id, role, content, created_at, compacted) VALUES (?, ?, ?, ?, ?, 0)"
    ).run(assistantMsgId, conversationId, "assistant", "", assistantCreatedAt);

    // Build a broadcast-only controller. No HTTP client owns this stream;
    // the raw enqueue sink is a noop. Observers subscribed via
    // `subscribeToConversationSse(conversationId, ...)` get the events.
    const rawController: SseStreamController = {
        enqueue() {
            // noop — everything of value goes through the broadcaster
        },
        close() {
            // noop
        }
    };
    const controller = wrapControllerWithBroadcast(rawController, conversationId);

    let aborted = false;

    controller.enqueue(
        sseEvent("assistant-start", {
            id: assistantMsgId,
            role: "assistant" as const,
            conversation_id: conversationId,
            created_at: assistantCreatedAt
        })
    );

    try {
        await runStreamTextIntoController({
            controller,
            workspaceId,
            conversationId,
            assistantMsgId,
            assistantCreatedAt,
            modelMessages,
            abortSignal,
            subagentOverrides: {
                subagentType,
                parentConversationId,
                modelOverride,
                reasoningEffortOverride
            }
        });
    } catch (error) {
        if (abortSignal.aborted || isAbortError(error)) {
            aborted = true;
        } else {
            throw error;
        }
    }

    if (abortSignal.aborted) aborted = true;

    const row = db
        .query("SELECT content FROM messages WHERE id = ?")
        .get(assistantMsgId) as { content: string } | null;
    const finalText = row?.content ?? "";

    return { finalText, aborted };
}
