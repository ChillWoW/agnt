import { getWorkspaceDb } from "../../lib/db";
import {
    linkAttachmentsToMessage,
    listAttachmentsForMessages
} from "../attachments/attachments.service";
import {
    recordStatSession,
    recordStatUserMessage
} from "../stats/stats.recorder";
import { closeSession as closeCodexWsSession } from "./codex-ws-session";
import { DEFAULT_CONVERSATION_TITLE } from "./conversation.constants";
import type {
    BranchInfo,
    Conversation,
    ConversationWithMessages,
    Message,
    MessageMention,
    MessageRole,
    ReasoningPart,
    SubagentType,
    ToolInvocation,
    ToolInvocationStatus
} from "./conversations.types";

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

interface ReasoningPartRow {
    id: string;
    message_id: string;
    text: string;
    started_at: string;
    ended_at: string | null;
    sort_index: number;
    message_seq: number | null;
}

function parseJsonOrNull(value: string | null): unknown {
    if (value === null) return null;
    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
}

function toolInvocationFromRow(row: ToolInvocationRow): ToolInvocation {
    return {
        id: row.id,
        message_id: row.message_id,
        tool_name: row.tool_name,
        input: parseJsonOrNull(row.input_json),
        output: parseJsonOrNull(row.output_json),
        error: row.error,
        status: row.status,
        created_at: row.created_at,
        message_seq: row.message_seq ?? null
    };
}

interface ConversationRow {
    id: string;
    title: string;
    created_at: string;
    updated_at: string;
    parent_conversation_id: string | null;
    subagent_type: string | null;
    subagent_name: string | null;
    hidden: number;
    archived_at: string | null;
    pinned_at: string | null;
    active_branch_group_id: string | null;
    active_branch_index: number;
}

function conversationFromRow(row: ConversationRow): Conversation {
    return {
        id: row.id,
        title: row.title,
        created_at: row.created_at,
        updated_at: row.updated_at,
        parent_conversation_id: row.parent_conversation_id,
        subagent_type: (row.subagent_type ?? null) as Conversation["subagent_type"],
        subagent_name: row.subagent_name,
        hidden: row.hidden === 1,
        archived_at: row.archived_at,
        pinned_at: row.pinned_at,
        active_branch_group_id: row.active_branch_group_id,
        active_branch_index: row.active_branch_index ?? 0
    };
}

const CONVERSATION_SELECT =
    "SELECT id, title, created_at, updated_at, parent_conversation_id, subagent_type, subagent_name, hidden, archived_at, pinned_at, active_branch_group_id, active_branch_index FROM conversations";

/**
 * Resolve the current branch state for a conversation. Returns the active
 * branch group id + index, or NULL if the conversation has no active branch
 * group (the common case). Used by `branchFilteredMessagesQuery` and by the
 * regenerate / edit / switch flows.
 */
export interface BranchState {
    groupId: string | null;
    index: number;
}

export function readBranchState(
    db: ReturnType<typeof getWorkspaceDb>,
    conversationId: string
): BranchState {
    const row = db
        .query(
            "SELECT active_branch_group_id, active_branch_index FROM conversations WHERE id = ?"
        )
        .get(conversationId) as
        | { active_branch_group_id: string | null; active_branch_index: number }
        | null;
    if (!row) return { groupId: null, index: 0 };
    return {
        groupId: row.active_branch_group_id ?? null,
        index: row.active_branch_index ?? 0
    };
}

/**
 * Build a SQL fragment + bound parameters for filtering `messages` rows to
 * just the ones visible under the conversation's currently-active branch.
 *
 * Non-branched rows (`branch_group_id IS NULL`) are always visible.
 * Branched rows are visible only when their group + index match the
 * conversation's `active_branch_*` columns.
 *
 * Use as part of any message-loading query, e.g.:
 *
 * ```ts
 * const { whereClause, params } = branchFilteredMessagesClause(db, conversationId);
 * db.query(`SELECT ... FROM messages WHERE conversation_id = ? ${whereClause} ORDER BY ...`)
 *   .all(conversationId, ...params)
 * ```
 *
 * The `whereClause` always begins with ` AND ` so it can be appended to an
 * existing WHERE without further conditional logic.
 */
export interface BranchFilterClause {
    /** Always begins with ` AND ` (or empty when no filter is needed). */
    whereClause: string;
    /** Positional parameters to splice in after the caller's existing args. */
    params: (string | number)[];
}

export function branchFilteredMessagesClause(
    db: ReturnType<typeof getWorkspaceDb>,
    conversationId: string,
    options: { tableAlias?: string } = {}
): BranchFilterClause {
    const state = readBranchState(db, conversationId);
    const prefix = options.tableAlias ? `${options.tableAlias}.` : "";

    if (!state.groupId) {
        // No active branch group: hide any orphaned branched rows so a
        // half-finished branch (e.g. from a crashed request) never leaks
        // back into history.
        return {
            whereClause: ` AND ${prefix}branch_group_id IS NULL`,
            params: []
        };
    }

    return {
        whereClause: ` AND (${prefix}branch_group_id IS NULL OR (${prefix}branch_group_id = ? AND ${prefix}branch_index = ?))`,
        params: [state.groupId, state.index]
    };
}

/**
 * Compute the `BranchInfo` summary for the conversation's active branch
 * group, or NULL when no group is active. Distinct branch indexes ≥ 1 means
 * the navigator should render. Used by `getConversation` so the response
 * carries the branch state alongside the message list.
 */
export function computeBranchInfo(
    db: ReturnType<typeof getWorkspaceDb>,
    conversationId: string
): BranchInfo | null {
    const state = readBranchState(db, conversationId);
    if (!state.groupId) return null;
    const row = db
        .query(
            "SELECT COUNT(DISTINCT branch_index) AS count FROM messages WHERE branch_group_id = ?"
        )
        .get(state.groupId) as { count: number } | null;
    const total = row?.count ?? 0;
    if (total <= 0) return null;
    return {
        groupId: state.groupId,
        activeIndex: state.index,
        total
    };
}

export function listConversations(workspaceId: string): Conversation[] {
    const db = getWorkspaceDb(workspaceId);
    const rows = db
        .query(
            `${CONVERSATION_SELECT} WHERE hidden = 0 AND parent_conversation_id IS NULL AND archived_at IS NULL ORDER BY updated_at DESC`
        )
        .all() as ConversationRow[];
    return rows.map(conversationFromRow);
}

export function listArchivedConversations(workspaceId: string): Conversation[] {
    const db = getWorkspaceDb(workspaceId);
    const rows = db
        .query(
            `${CONVERSATION_SELECT} WHERE hidden = 0 AND parent_conversation_id IS NULL AND archived_at IS NOT NULL ORDER BY archived_at DESC`
        )
        .all() as ConversationRow[];
    return rows.map(conversationFromRow);
}

export function listSubagents(
    workspaceId: string,
    parentConversationId: string
): Conversation[] {
    const db = getWorkspaceDb(workspaceId);
    const rows = db
        .query(
            `${CONVERSATION_SELECT} WHERE parent_conversation_id = ? ORDER BY created_at ASC`
        )
        .all(parentConversationId) as ConversationRow[];
    return rows.map(conversationFromRow);
}

export function getConversation(workspaceId: string, conversationId: string): ConversationWithMessages {
    const db = getWorkspaceDb(workspaceId);

    const row = db
        .query(`${CONVERSATION_SELECT} WHERE id = ?`)
        .get(conversationId) as ConversationRow | null;
    const conversation = row ? conversationFromRow(row) : null;

    if (!conversation) {
        throw new Error(`Conversation not found: ${conversationId}`);
    }

    interface MessageRow {
        id: string;
        conversation_id: string;
        role: MessageRole;
        content: string;
        reasoning_content: string | null;
        reasoning_started_at: string | null;
        reasoning_ended_at: string | null;
        created_at: string;
        input_tokens: number | null;
        output_tokens: number | null;
        reasoning_tokens: number | null;
        total_tokens: number | null;
        compacted: number;
        summary_of_until: string | null;
        model_id: string | null;
        generation_duration_ms: number | null;
        branch_group_id: string | null;
        branch_index: number;
    }

    const branchClause = branchFilteredMessagesClause(db, conversationId);
    const rows = db
        .query(
            `SELECT id, conversation_id, role, content, reasoning_content, reasoning_started_at, reasoning_ended_at, created_at, input_tokens, output_tokens, reasoning_tokens, total_tokens, compacted, summary_of_until, model_id, generation_duration_ms, branch_group_id, branch_index FROM messages WHERE conversation_id = ?${branchClause.whereClause} ORDER BY created_at ASC`
        )
        .all(conversationId, ...branchClause.params) as MessageRow[];

    const messages: Message[] = rows.map((row) => ({
        id: row.id,
        conversation_id: row.conversation_id,
        role: row.role,
        content: row.content,
        ...(row.reasoning_content ? { reasoning: row.reasoning_content } : {}),
        ...(row.reasoning_started_at
            ? { reasoning_started_at: row.reasoning_started_at }
            : {}),
        ...(row.reasoning_ended_at
            ? { reasoning_ended_at: row.reasoning_ended_at }
            : {}),
        created_at: row.created_at,
        input_tokens: row.input_tokens,
        output_tokens: row.output_tokens,
        reasoning_tokens: row.reasoning_tokens,
        total_tokens: row.total_tokens,
        compacted: row.compacted === 1,
        summary_of_until: row.summary_of_until,
        model_id: row.model_id,
        generation_duration_ms: row.generation_duration_ms,
        branch_group_id: row.branch_group_id,
        branch_index: row.branch_index ?? 0
    }));

    const branchInfo = computeBranchInfo(db, conversationId);

    if (messages.length === 0) {
        return { ...conversation, messages, branch_info: branchInfo };
    }

    const messageIds = messages.map((m) => m.id);
    const placeholders = messageIds.map(() => "?").join(",");
    const invocationRows = db
        .query(
            `SELECT id, message_id, tool_name, input_json, output_json, error, status, created_at, message_seq FROM tool_invocations WHERE message_id IN (${placeholders}) ORDER BY created_at ASC`
        )
        .all(...messageIds) as ToolInvocationRow[];

    const invocationsByMessage = new Map<string, ToolInvocation[]>();
    for (const row of invocationRows) {
        const list = invocationsByMessage.get(row.message_id) ?? [];
        list.push(toolInvocationFromRow(row));
        invocationsByMessage.set(row.message_id, list);
    }

    const reasoningRows = db
        .query(
            `SELECT id, message_id, text, started_at, ended_at, sort_index, message_seq FROM message_reasoning_parts WHERE message_id IN (${placeholders}) ORDER BY sort_index ASC`
        )
        .all(...messageIds) as ReasoningPartRow[];

    const reasoningByMessage = new Map<string, ReasoningPart[]>();
    for (const row of reasoningRows) {
        const list = reasoningByMessage.get(row.message_id) ?? [];
        list.push({
            id: row.id,
            message_id: row.message_id,
            text: row.text,
            started_at: row.started_at,
            ended_at: row.ended_at,
            sort_index: row.sort_index,
            message_seq: row.message_seq ?? null
        });
        reasoningByMessage.set(row.message_id, list);
    }

    const attachmentDtos = listAttachmentsForMessages(workspaceId, messageIds);
    const attachmentsByMessage = new Map<string, typeof attachmentDtos>();
    for (const att of attachmentDtos) {
        if (!att.message_id) continue;
        const list = attachmentsByMessage.get(att.message_id) ?? [];
        list.push(att);
        attachmentsByMessage.set(att.message_id, list);
    }

    const messagesWithTools: Message[] = messages.map((m) => {
        const tools = invocationsByMessage.get(m.id);
        const attachments = attachmentsByMessage.get(m.id);
        const reasoningParts = reasoningByMessage.get(m.id);
        const enriched: Message = {
            ...m,
            ...(tools && tools.length > 0 ? { tool_invocations: tools } : {}),
            ...(attachments && attachments.length > 0
                ? { attachments }
                : {}),
            ...(reasoningParts && reasoningParts.length > 0
                ? { reasoning_parts: reasoningParts }
                : {})
        };
        return enriched;
    });

    return {
        ...conversation,
        messages: messagesWithTools,
        branch_info: branchInfo
    };
}

/**
 * Apply a branch index switch atomically and return the freshly-loaded
 * conversation. Throws if the requested index is out of range for the
 * conversation's currently-active branch group, or if there is no group.
 */
export function switchBranch(
    workspaceId: string,
    conversationId: string,
    index: number
): ConversationWithMessages {
    const db = getWorkspaceDb(workspaceId);

    const state = readBranchState(db, conversationId);
    if (!state.groupId) {
        throw new Error(
            `Conversation ${conversationId} has no active branch group`
        );
    }

    const totalRow = db
        .query(
            "SELECT COUNT(DISTINCT branch_index) AS count FROM messages WHERE branch_group_id = ?"
        )
        .get(state.groupId) as { count: number } | null;
    const total = totalRow?.count ?? 0;

    if (!Number.isInteger(index) || index < 0 || index >= total) {
        throw new Error(
            `Invalid branch index ${index} (group has ${total} alternatives)`
        );
    }

    db.query(
        "UPDATE conversations SET active_branch_index = ?, updated_at = ? WHERE id = ?"
    ).run(index, new Date().toISOString(), conversationId);

    return getConversation(workspaceId, conversationId);
}

/**
 * Seal the conversation's active branch (if any) into permanent history:
 * delete every alternative whose `branch_index` differs from the active
 * one, clear `branch_group_id` / `branch_index` on the surviving rows, and
 * clear the conversation's `active_branch_*` columns. Used by
 * `streamConversationReply` so a regular follow-up message commits whichever
 * alternative the user was looking at and discards the rest.
 *
 * No-op when no branch group is active.
 */
export function sealBranches(
    db: ReturnType<typeof getWorkspaceDb>,
    conversationId: string
): void {
    const state = readBranchState(db, conversationId);
    if (!state.groupId) return;

    const tx = db.transaction(() => {
        // Drop every non-active alternative. FK cascades wipe their tool
        // invocations / reasoning parts / attachments automatically.
        db.query(
            "DELETE FROM messages WHERE branch_group_id = ? AND branch_index != ?"
        ).run(state.groupId!, state.index);

        // Re-graft the surviving alternative into permanent history.
        db.query(
            "UPDATE messages SET branch_group_id = NULL, branch_index = 0 WHERE branch_group_id = ?"
        ).run(state.groupId!);

        db.query(
            "UPDATE conversations SET active_branch_group_id = NULL, active_branch_index = 0 WHERE id = ?"
        ).run(conversationId);
    });

    tx();
}

export function createConversation(
    workspaceId: string,
    firstMessage: string,
    attachmentIds: string[] = [],
    _mentions: MessageMention[] = [],
    useSkillNames: string[] = []
): ConversationWithMessages {
    const db = getWorkspaceDb(workspaceId);

    const conversationId = crypto.randomUUID();
    const messageId = crypto.randomUUID();
    const now = new Date().toISOString();
    // The home flow goes `createConversation` -> `/reply` -> stream, and the
    // `/reply` endpoint takes no body — so we persist requested skill names
    // on the user message row itself. The stream layer reads them back from
    // the latest user message in `streamReplyToLastMessage`. NULL means
    // "no slash command was used"; an empty string means the same.
    const skillNamesJson =
        useSkillNames.length > 0 ? JSON.stringify(useSkillNames) : null;

    const tx = db.transaction(() => {
        db.query(
            "INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)"
        ).run(conversationId, DEFAULT_CONVERSATION_TITLE, now, now);

        db.query(
            "INSERT INTO messages (id, conversation_id, role, content, created_at, use_skill_names) VALUES (?, ?, ?, ?, ?, ?)"
        ).run(
            messageId,
            conversationId,
            "user",
            firstMessage,
            now,
            skillNamesJson
        );
    });

    tx();

    // Record the lifetime session + first user message in the append-only
    // stats ledger (~/.agnt/stats.db). These rows survive conversation
    // deletion so the dashboard keeps counting them forever.
    recordStatSession({ workspaceId, conversationId, createdAt: now });
    recordStatUserMessage({
        workspaceId,
        conversationId,
        messageId,
        createdAt: now
    });

    const attachments =
        attachmentIds.length > 0
            ? linkAttachmentsToMessage(
                  workspaceId,
                  attachmentIds,
                  conversationId,
                  messageId
              )
            : [];

    return {
        id: conversationId,
        title: DEFAULT_CONVERSATION_TITLE,
        created_at: now,
        updated_at: now,
        parent_conversation_id: null,
        subagent_type: null,
        subagent_name: null,
        hidden: false,
        archived_at: null,
        pinned_at: null,
        messages: [
            {
                id: messageId,
                conversation_id: conversationId,
                role: "user",
                content: firstMessage,
                created_at: now,
                ...(attachments.length > 0 ? { attachments } : {})
            }
        ]
    };
}

export interface CreateSubagentConversationParams {
    parentConversationId: string;
    subagentType: SubagentType;
    subagentName: string;
    title: string;
    initialUserMessage: string;
}

export function createSubagentConversation(
    workspaceId: string,
    params: CreateSubagentConversationParams
): ConversationWithMessages {
    const db = getWorkspaceDb(workspaceId);
    const conversationId = crypto.randomUUID();
    const messageId = crypto.randomUUID();
    const now = new Date().toISOString();

    const tx = db.transaction(() => {
        db.query(
            "INSERT INTO conversations (id, title, created_at, updated_at, parent_conversation_id, subagent_type, subagent_name, hidden) VALUES (?, ?, ?, ?, ?, ?, ?, 1)"
        ).run(
            conversationId,
            params.title,
            now,
            now,
            params.parentConversationId,
            params.subagentType,
            params.subagentName
        );

        db.query(
            "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)"
        ).run(messageId, conversationId, "user", params.initialUserMessage, now);
    });

    tx();

    return {
        id: conversationId,
        title: params.title,
        created_at: now,
        updated_at: now,
        parent_conversation_id: params.parentConversationId,
        subagent_type: params.subagentType,
        subagent_name: params.subagentName,
        hidden: true,
        archived_at: null,
        pinned_at: null,
        messages: [
            {
                id: messageId,
                conversation_id: conversationId,
                role: "user",
                content: params.initialUserMessage,
                created_at: now
            }
        ]
    };
}

export function addMessage(
    workspaceId: string,
    conversationId: string,
    role: MessageRole,
    content: string
): Message {
    const db = getWorkspaceDb(workspaceId);
    const now = new Date().toISOString();
    const messageId = crypto.randomUUID();

    const existing = db
        .query("SELECT id FROM conversations WHERE id = ?")
        .get(conversationId);

    if (!existing) {
        throw new Error(`Conversation not found: ${conversationId}`);
    }

    const tx = db.transaction(() => {
        db.query(
            "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)"
        ).run(messageId, conversationId, role, content, now);

        db.query(
            "UPDATE conversations SET updated_at = ? WHERE id = ?"
        ).run(now, conversationId);
    });

    tx();

    // Only user messages count toward the stats ledger — assistant rows are
    // recorded from the stream's onFinish (so we have tokens + model).
    if (role === "user") {
        recordStatUserMessage({
            workspaceId,
            conversationId,
            messageId,
            createdAt: now
        });
    }

    return {
        id: messageId,
        conversation_id: conversationId,
        role,
        content,
        created_at: now
    };
}

export function deleteConversation(workspaceId: string, conversationId: string): void {
    const db = getWorkspaceDb(workspaceId);

    const existing = db
        .query("SELECT id FROM conversations WHERE id = ?")
        .get(conversationId);

    if (!existing) {
        throw new Error(`Conversation not found: ${conversationId}`);
    }

    const tx = db.transaction(() => {
        db.query("DELETE FROM messages WHERE conversation_id = ?").run(conversationId);
        db.query("DELETE FROM conversations WHERE id = ?").run(conversationId);
    });

    tx();

    // Tear down any persistent Codex WebSocket session for this conversation
    // so we don't leak the socket (and its incremental baseline) after the
    // conversation row is gone.
    closeCodexWsSession(conversationId);
}

export function archiveConversation(
    workspaceId: string,
    conversationId: string
): { archived_at: string } {
    const db = getWorkspaceDb(workspaceId);

    const existing = db
        .query("SELECT id FROM conversations WHERE id = ?")
        .get(conversationId);

    if (!existing) {
        throw new Error(`Conversation not found: ${conversationId}`);
    }

    const now = new Date().toISOString();
    // Archiving auto-unpins. The Pinned sidebar group is meant to surface
    // active work; an archived conversation should never appear there. If
    // the user later un-archives, the conversation comes back unpinned —
    // the user re-pins explicitly.
    db.query(
        "UPDATE conversations SET archived_at = ?, pinned_at = NULL WHERE id = ?"
    ).run(now, conversationId);

    return { archived_at: now };
}

export function pinConversation(
    workspaceId: string,
    conversationId: string
): { pinned_at: string } {
    const db = getWorkspaceDb(workspaceId);

    const existing = db
        .query("SELECT id FROM conversations WHERE id = ?")
        .get(conversationId);

    if (!existing) {
        throw new Error(`Conversation not found: ${conversationId}`);
    }

    // Always overwrite the timestamp on re-pin so the row floats back to
    // the top of `ORDER BY pinned_at DESC` even if it was already pinned.
    const now = new Date().toISOString();
    db.query("UPDATE conversations SET pinned_at = ? WHERE id = ?").run(
        now,
        conversationId
    );

    return { pinned_at: now };
}

export function unpinConversation(
    workspaceId: string,
    conversationId: string
): void {
    const db = getWorkspaceDb(workspaceId);

    const existing = db
        .query("SELECT id FROM conversations WHERE id = ?")
        .get(conversationId);

    if (!existing) {
        throw new Error(`Conversation not found: ${conversationId}`);
    }

    db.query("UPDATE conversations SET pinned_at = NULL WHERE id = ?").run(
        conversationId
    );
}

export function unarchiveConversation(
    workspaceId: string,
    conversationId: string
): void {
    const db = getWorkspaceDb(workspaceId);

    const existing = db
        .query("SELECT id FROM conversations WHERE id = ?")
        .get(conversationId);

    if (!existing) {
        throw new Error(`Conversation not found: ${conversationId}`);
    }

    db.query(
        "UPDATE conversations SET archived_at = NULL WHERE id = ?"
    ).run(conversationId);
}

export function updateConversation(
    workspaceId: string,
    conversationId: string,
    updates: { title?: string }
): Conversation {
    const db = getWorkspaceDb(workspaceId);
    const now = new Date().toISOString();

    const row = db
        .query(`${CONVERSATION_SELECT} WHERE id = ?`)
        .get(conversationId) as ConversationRow | null;

    if (!row) {
        throw new Error(`Conversation not found: ${conversationId}`);
    }

    const existing = conversationFromRow(row);
    const newTitle = updates.title ?? existing.title;

    db.query(
        "UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?"
    ).run(newTitle, now, conversationId);

    return { ...existing, title: newTitle, updated_at: now };
}
