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
    reasoning_content TEXT,
    reasoning_started_at TEXT,
    reasoning_ended_at TEXT,
    created_at TEXT NOT NULL,
    input_tokens INTEGER,
    output_tokens INTEGER,
    reasoning_tokens INTEGER,
    total_tokens INTEGER,
    compacted INTEGER NOT NULL DEFAULT 0,
    summary_of_until TEXT
);

CREATE TABLE IF NOT EXISTS state_entries (
    scope_type TEXT NOT NULL CHECK(scope_type IN ('workspace', 'conversation')),
    scope_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (scope_type, scope_id, key)
);

CREATE TABLE IF NOT EXISTS history_entries (
    id TEXT PRIMARY KEY,
    scope_type TEXT NOT NULL CHECK(scope_type IN ('workspace', 'conversation')),
    scope_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value_json TEXT NOT NULL,
    source TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tool_invocations (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    tool_name TEXT NOT NULL,
    input_json TEXT NOT NULL,
    output_json TEXT,
    error TEXT,
    status TEXT NOT NULL CHECK(status IN ('pending', 'success', 'error')),
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY,
    conversation_id TEXT,
    message_id TEXT REFERENCES messages(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    storage_path TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('image', 'file')),
    created_at TEXT NOT NULL,
    estimated_tokens INTEGER
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_compacted ON messages(conversation_id, compacted, created_at);
CREATE INDEX IF NOT EXISTS idx_state_entries_scope ON state_entries(scope_type, scope_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_history_entries_scope ON history_entries(scope_type, scope_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_history_entries_scope_key ON history_entries(scope_type, scope_id, key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tool_invocations_message ON tool_invocations(message_id, created_at);
CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments(message_id, created_at);
CREATE INDEX IF NOT EXISTS idx_attachments_pending ON attachments(conversation_id, message_id, created_at);
`;

interface TableInfoRow {
    name: string;
}

function columnExists(db: Database, table: string, column: string): boolean {
    const rows = db.query(`PRAGMA table_info(${table})`).all() as TableInfoRow[];
    return rows.some((row) => row.name === column);
}

function addColumnIfMissing(
    db: Database,
    table: string,
    column: string,
    definition: string
): void {
    if (columnExists(db, table, column)) return;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
}

function runMigrations(db: Database): void {
    addColumnIfMissing(db, "messages", "reasoning_content", "TEXT");
    addColumnIfMissing(db, "messages", "reasoning_started_at", "TEXT");
    addColumnIfMissing(db, "messages", "reasoning_ended_at", "TEXT");
    addColumnIfMissing(db, "messages", "input_tokens", "INTEGER");
    addColumnIfMissing(db, "messages", "output_tokens", "INTEGER");
    addColumnIfMissing(db, "messages", "reasoning_tokens", "INTEGER");
    addColumnIfMissing(db, "messages", "total_tokens", "INTEGER");
    addColumnIfMissing(
        db,
        "messages",
        "compacted",
        "INTEGER NOT NULL DEFAULT 0"
    );
    addColumnIfMissing(db, "messages", "summary_of_until", "TEXT");

    addColumnIfMissing(db, "attachments", "estimated_tokens", "INTEGER");

    db.exec(
        "CREATE INDEX IF NOT EXISTS idx_messages_compacted ON messages(conversation_id, compacted, created_at);"
    );
}

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
    runMigrations(db);

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
