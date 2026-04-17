import { getWorkspaceDb } from "../../lib/db";
import {
    linkAttachmentsToMessage,
    listAttachmentsForMessages
} from "../attachments/attachments.service";
import type {
    Conversation,
    ConversationWithMessages,
    Message,
    MessageRole,
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
        created_at: row.created_at
    };
}

export function listConversations(workspaceId: string): Conversation[] {
    const db = getWorkspaceDb(workspaceId);
    return db
        .query("SELECT id, title, created_at, updated_at FROM conversations ORDER BY updated_at DESC")
        .all() as Conversation[];
}

export function getConversation(workspaceId: string, conversationId: string): ConversationWithMessages {
    const db = getWorkspaceDb(workspaceId);

    const conversation = db
        .query("SELECT id, title, created_at, updated_at FROM conversations WHERE id = ?")
        .get(conversationId) as Conversation | null;

    if (!conversation) {
        throw new Error(`Conversation not found: ${conversationId}`);
    }

    interface MessageRow {
        id: string;
        conversation_id: string;
        role: MessageRole;
        content: string;
        created_at: string;
        input_tokens: number | null;
        output_tokens: number | null;
        reasoning_tokens: number | null;
        total_tokens: number | null;
        compacted: number;
        summary_of_until: string | null;
    }

    const rows = db
        .query(
            "SELECT id, conversation_id, role, content, created_at, input_tokens, output_tokens, reasoning_tokens, total_tokens, compacted, summary_of_until FROM messages WHERE conversation_id = ? ORDER BY created_at ASC"
        )
        .all(conversationId) as MessageRow[];

    const messages: Message[] = rows.map((row) => ({
        id: row.id,
        conversation_id: row.conversation_id,
        role: row.role,
        content: row.content,
        created_at: row.created_at,
        input_tokens: row.input_tokens,
        output_tokens: row.output_tokens,
        reasoning_tokens: row.reasoning_tokens,
        total_tokens: row.total_tokens,
        compacted: row.compacted === 1,
        summary_of_until: row.summary_of_until
    }));

    if (messages.length === 0) {
        return { ...conversation, messages };
    }

    const messageIds = messages.map((m) => m.id);
    const placeholders = messageIds.map(() => "?").join(",");
    const invocationRows = db
        .query(
            `SELECT id, message_id, tool_name, input_json, output_json, error, status, created_at FROM tool_invocations WHERE message_id IN (${placeholders}) ORDER BY created_at ASC`
        )
        .all(...messageIds) as ToolInvocationRow[];

    const invocationsByMessage = new Map<string, ToolInvocation[]>();
    for (const row of invocationRows) {
        const list = invocationsByMessage.get(row.message_id) ?? [];
        list.push(toolInvocationFromRow(row));
        invocationsByMessage.set(row.message_id, list);
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
        const enriched: Message = {
            ...m,
            ...(tools && tools.length > 0 ? { tool_invocations: tools } : {}),
            ...(attachments && attachments.length > 0
                ? { attachments }
                : {})
        };
        return enriched;
    });

    return { ...conversation, messages: messagesWithTools };
}

export function createConversation(
    workspaceId: string,
    firstMessage: string,
    attachmentIds: string[] = []
): ConversationWithMessages {
    const db = getWorkspaceDb(workspaceId);

    const conversationId = crypto.randomUUID();
    const messageId = crypto.randomUUID();
    const now = new Date().toISOString();

    const tx = db.transaction(() => {
        db.query(
            "INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)"
        ).run(conversationId, "New conversation", now, now);

        db.query(
            "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)"
        ).run(messageId, conversationId, "user", firstMessage, now);
    });

    tx();

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
        title: "New conversation",
        created_at: now,
        updated_at: now,
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

    const existing = db
        .query("SELECT id, title, created_at, updated_at FROM conversations WHERE id = ?")
        .get(conversationId) as Conversation | null;

    if (!existing) {
        throw new Error(`Conversation not found: ${conversationId}`);
    }

    const newTitle = updates.title ?? existing.title;

    db.query(
        "UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?"
    ).run(newTitle, now, conversationId);

    return { ...existing, title: newTitle, updated_at: now };
}
