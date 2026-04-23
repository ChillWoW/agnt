import { mkdirSync, writeFileSync, readFileSync, unlinkSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { getWorkspaceDb } from "../../../lib/db";
import { getHomePath } from "../../../lib/homedir";
import { logger } from "../../../lib/logger";

export interface PlanTodo {
    id: string;
    content: string;
}

export interface Plan {
    id: string;
    conversation_id: string;
    file_path: string;
    title: string | null;
    content: string;
    todos: PlanTodo[];
    created_at: string;
    updated_at: string;
}

interface PlanRow {
    id: string;
    conversation_id: string;
    file_path: string;
    title: string | null;
    todos_json: string;
    created_at: string;
    updated_at: string;
}

// ---------------------------------------------------------------------------
// Pub/sub
// ---------------------------------------------------------------------------

export interface PlanUpdatedEvent {
    conversationId: string;
    plan: Plan;
}

type PlanListener = (event: PlanUpdatedEvent) => void;

const listeners = new Map<string, Set<PlanListener>>();

export function subscribeToPlanUpdates(
    conversationId: string,
    listener: PlanListener
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

function emitPlanUpdated(event: PlanUpdatedEvent): void {
    const set = listeners.get(event.conversationId);
    if (!set) return;
    for (const listener of set) {
        try {
            listener(event);
        } catch (error) {
            logger.error("[plans] listener error", error);
        }
    }
}

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

function ensureDir(dir: string): void {
    try {
        mkdirSync(dir, { recursive: true });
    } catch {
        // already exists
    }
}

function plansDir(): string {
    return getHomePath("plans");
}

function writePlanFile(filePath: string, content: string): void {
    ensureDir(dirname(filePath));
    writeFileSync(filePath, content, "utf-8");
}

function readPlanFile(filePath: string): string {
    return readFileSync(filePath, "utf-8");
}

function deletePlanFile(filePath: string): void {
    try {
        unlinkSync(filePath);
    } catch {
        // file may already be gone
    }
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export function createOrUpdatePlan(
    workspaceId: string,
    conversationId: string,
    content: string,
    title?: string,
    todos?: { id?: string; content: string }[]
): Plan {
    const db = getWorkspaceDb(workspaceId);
    const now = new Date().toISOString();

    const existing = db
        .query("SELECT * FROM plans WHERE conversation_id = ?")
        .get(conversationId) as PlanRow | null;

    const planTodos: PlanTodo[] = (todos ?? []).map((t) => ({
        id: t.id ?? crypto.randomUUID(),
        content: t.content
    }));
    const todosJson = JSON.stringify(planTodos);

    let plan: Plan;

    if (existing) {
        writePlanFile(existing.file_path, content);

        db.query(
            "UPDATE plans SET title = ?, todos_json = ?, updated_at = ? WHERE id = ?"
        ).run(title ?? existing.title, todosJson, now, existing.id);

        plan = {
            id: existing.id,
            conversation_id: conversationId,
            file_path: existing.file_path,
            title: title ?? existing.title,
            content,
            todos: planTodos,
            created_at: existing.created_at,
            updated_at: now
        };
    } else {
        const id = crypto.randomUUID();
        const filePath = `${plansDir()}/plan-${id}.md`;
        writePlanFile(filePath, content);

        db.query(
            "INSERT INTO plans (id, conversation_id, file_path, title, todos_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
        ).run(id, conversationId, filePath, title ?? null, todosJson, now, now);

        plan = {
            id,
            conversation_id: conversationId,
            file_path: filePath,
            title: title ?? null,
            content,
            todos: planTodos,
            created_at: now,
            updated_at: now
        };
    }

    logger.log("[plans] createOrUpdatePlan", {
        id: plan.id,
        conversationId,
        todoCount: planTodos.length
    });

    emitPlanUpdated({ conversationId, plan });
    return plan;
}

export function getPlan(
    workspaceId: string,
    conversationId: string
): Plan | null {
    const db = getWorkspaceDb(workspaceId);
    const row = db
        .query("SELECT * FROM plans WHERE conversation_id = ?")
        .get(conversationId) as PlanRow | null;

    if (!row) return null;

    let content = "";
    try {
        if (existsSync(row.file_path)) {
            content = readPlanFile(row.file_path);
        }
    } catch (error) {
        logger.error("[plans] failed to read plan file", error);
    }

    let todos: PlanTodo[] = [];
    try {
        todos = JSON.parse(row.todos_json);
    } catch {
        // malformed JSON, keep empty
    }

    return {
        id: row.id,
        conversation_id: row.conversation_id,
        file_path: row.file_path,
        title: row.title,
        content,
        todos,
        created_at: row.created_at,
        updated_at: row.updated_at
    };
}

export function deletePlan(
    workspaceId: string,
    conversationId: string
): boolean {
    const db = getWorkspaceDb(workspaceId);
    const row = db
        .query("SELECT * FROM plans WHERE conversation_id = ?")
        .get(conversationId) as PlanRow | null;

    if (!row) return false;

    deletePlanFile(row.file_path);
    db.query("DELETE FROM plans WHERE id = ?").run(row.id);

    logger.log("[plans] deletePlan", { id: row.id, conversationId });
    return true;
}

export function listPlans(workspaceId: string): Plan[] {
    const db = getWorkspaceDb(workspaceId);
    const rows = db
        .query("SELECT * FROM plans ORDER BY updated_at DESC")
        .all() as PlanRow[];

    return rows.map((row) => {
        let content = "";
        try {
            if (existsSync(row.file_path)) {
                content = readPlanFile(row.file_path);
            }
        } catch {
            // skip unreadable files
        }

        let todos: PlanTodo[] = [];
        try {
            todos = JSON.parse(row.todos_json);
        } catch {
            // malformed JSON
        }

        return {
            id: row.id,
            conversation_id: row.conversation_id,
            file_path: row.file_path,
            title: row.title,
            content,
            todos,
            created_at: row.created_at,
            updated_at: row.updated_at
        };
    });
}
