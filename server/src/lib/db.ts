import { Database } from "bun:sqlite";
import { getHomePath } from "./homedir";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const dbCache = new Map<string, Database>();

const SCHEMA = `
CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT 'New conversation',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
`;

function ensureDir(dir: string): void {
    try {
        mkdirSync(dir, { recursive: true });
    } catch {
        // already exists
    }
}

export function getWorkspaceDb(workspaceId: string): Database {
    const cached = dbCache.get(workspaceId);
    if (cached) return cached;

    const dbPath = getHomePath("workspaces", workspaceId, "conversations.db");
    ensureDir(dirname(dbPath));

    const db = new Database(dbPath);
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec(SCHEMA);

    dbCache.set(workspaceId, db);
    return db;
}

export function closeWorkspaceDb(workspaceId: string): void {
    const db = dbCache.get(workspaceId);
    if (db) {
        db.close();
        dbCache.delete(workspaceId);
    }
}
