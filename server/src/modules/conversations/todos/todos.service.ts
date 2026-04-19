import { getWorkspaceDb } from "../../../lib/db";
import { countTokens } from "../../../lib/tokenizer";
import { logger } from "../../../lib/logger";

export type TodoStatus =
    | "pending"
    | "in_progress"
    | "completed"
    | "cancelled";

export interface Todo {
    id: string;
    conversation_id: string;
    content: string;
    status: TodoStatus;
    sort_index: number;
    created_at: string;
    updated_at: string;
}

export interface TodoInput {
    id?: string;
    content: string;
    status: TodoStatus;
}

interface TodoRow {
    id: string;
    conversation_id: string;
    content: string;
    status: TodoStatus;
    sort_index: number;
    created_at: string;
    updated_at: string;
}

type TodosListener = (event: TodosUpdatedEvent) => void;

export interface TodosUpdatedEvent {
    conversationId: string;
    todos: Todo[];
}

const listeners = new Map<string, Set<TodosListener>>();

export function subscribeToTodos(
    conversationId: string,
    listener: TodosListener
): () => void {
    let set = listeners.get(conversationId);
    if (!set) {
        set = new Set();
        listeners.set(conversationId, set);
    }
    set.add(listener);
    return () => {
        const s = listeners.get(conversationId);
        if (!s) return;
        s.delete(listener);
        if (s.size === 0) listeners.delete(conversationId);
    };
}

function emitTodosUpdated(event: TodosUpdatedEvent): void {
    const set = listeners.get(event.conversationId);
    if (!set) return;
    for (const listener of set) {
        try {
            listener(event);
        } catch (error) {
            logger.error("[todos] listener error", error);
        }
    }
}

export function listTodos(
    workspaceId: string,
    conversationId: string
): Todo[] {
    const db = getWorkspaceDb(workspaceId);
    return db
        .query(
            "SELECT id, conversation_id, content, status, sort_index, created_at, updated_at FROM todos WHERE conversation_id = ? ORDER BY sort_index ASC, created_at ASC"
        )
        .all(conversationId) as TodoRow[];
}

/**
 * Atomically replace the entire todo list for a conversation. Existing rows
 * with matching ids are updated (preserving created_at), unknown ids become
 * new rows, and rows missing from the new list are deleted.
 */
export function replaceTodos(
    workspaceId: string,
    conversationId: string,
    inputs: TodoInput[]
): Todo[] {
    const db = getWorkspaceDb(workspaceId);

    const existing = listTodos(workspaceId, conversationId);
    const existingById = new Map(existing.map((t) => [t.id, t]));

    const now = new Date().toISOString();
    const keptIds = new Set<string>();
    const final: Todo[] = [];

    const tx = db.transaction(() => {
        inputs.forEach((input, index) => {
            const id =
                input.id && existingById.has(input.id)
                    ? input.id
                    : crypto.randomUUID();
            const prior = existingById.get(id);
            const createdAt = prior?.created_at ?? now;
            const sortIndex = index;

            if (prior) {
                db.query(
                    "UPDATE todos SET content = ?, status = ?, sort_index = ?, updated_at = ? WHERE id = ?"
                ).run(input.content, input.status, sortIndex, now, id);
            } else {
                db.query(
                    "INSERT INTO todos (id, conversation_id, content, status, sort_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
                ).run(
                    id,
                    conversationId,
                    input.content,
                    input.status,
                    sortIndex,
                    createdAt,
                    now
                );
            }

            keptIds.add(id);
            final.push({
                id,
                conversation_id: conversationId,
                content: input.content,
                status: input.status,
                sort_index: sortIndex,
                created_at: createdAt,
                updated_at: now
            });
        });

        for (const prior of existing) {
            if (!keptIds.has(prior.id)) {
                db.query("DELETE FROM todos WHERE id = ?").run(prior.id);
            }
        }
    });

    tx();

    emitTodosUpdated({ conversationId, todos: final });
    return final;
}

export function clearTodos(
    workspaceId: string,
    conversationId: string
): void {
    const db = getWorkspaceDb(workspaceId);
    db.query("DELETE FROM todos WHERE conversation_id = ?").run(conversationId);
    emitTodosUpdated({ conversationId, todos: [] });
}

const STATUS_GLYPH: Record<TodoStatus, string> = {
    pending: "[ ]",
    in_progress: "[~]",
    completed: "[x]",
    cancelled: "[-]"
};

export function buildTodosPromptBlock(todos: Todo[]): string {
    if (todos.length === 0) {
        return "";
    }
    const lines = todos.map(
        (t, i) => `${i + 1}. ${STATUS_GLYPH[t.status]} ${t.content}`
    );
    return `\n\n## Current Todos\nThe following plan is being tracked for this conversation. Keep it accurate by calling \`todo_write\` whenever you start, finish, or change a step. Exactly one todo should be \`in_progress\` while you are actively working.\n\n${lines.join("\n")}`;
}

export function countTodosTokens(todos: Todo[]): number {
    const block = buildTodosPromptBlock(todos);
    return block.length > 0 ? countTokens(block) : 0;
}
