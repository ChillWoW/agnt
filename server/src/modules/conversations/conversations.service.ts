import { getWorkspaceDb } from "../../lib/db";
import {
    linkAttachmentsToMessage,
    listAttachmentsForMessages
} from "../attachments/attachments.service";
import {
    recordStatSession,
    recordStatUserMessage
} from "../stats/stats.recorder";
import { DEFAULT_CONVERSATION_TITLE } from "./conversation.constants";
import type {
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
        hidden: row.hidden === 1
    };
}

const CONVERSATION_SELECT =
    "SELECT id, title, created_at, updated_at, parent_conversation_id, subagent_type, subagent_name, hidden FROM conversations";

export function listConversations(workspaceId: string): Conversation[] {
    const db = getWorkspaceDb(workspaceId);
    const rows = db
        .query(
            `${CONVERSATION_SELECT} WHERE hidden = 0 AND parent_conversation_id IS NULL ORDER BY updated_at DESC`
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
    }

    const rows = db
        .query(
            "SELECT id, conversation_id, role, content, reasoning_content, reasoning_started_at, reasoning_ended_at, created_at, input_tokens, output_tokens, reasoning_tokens, total_tokens, compacted, summary_of_until, model_id, generation_duration_ms FROM messages WHERE conversation_id = ? ORDER BY created_at ASC"
        )
        .all(conversationId) as MessageRow[];

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
        generation_duration_ms: row.generation_duration_ms
    }));

    if (messages.length === 0) {
        return { ...conversation, messages };
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

    return { ...conversation, messages: messagesWithTools };
}

export function createConversation(
    workspaceId: string,
    firstMessage: string,
    attachmentIds: string[] = [],
    _mentions: MessageMention[] = []
): ConversationWithMessages {
    const db = getWorkspaceDb(workspaceId);

    const conversationId = crypto.randomUUID();
    const messageId = crypto.randomUUID();
    const now = new Date().toISOString();

    const tx = db.transaction(() => {
        db.query(
            "INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)"
        ).run(conversationId, DEFAULT_CONVERSATION_TITLE, now, now);

        db.query(
            "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)"
        ).run(messageId, conversationId, "user", firstMessage, now);
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
