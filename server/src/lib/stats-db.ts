import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { getHomePath } from "./homedir";

/**
 * Stats database — an append-only ledger of lifetime user activity.
 *
 * Lives at ~/.agnt/stats.db, completely independent of any workspace's
 * conversation database. Rows here are NEVER deleted when a user removes
 * a conversation (the whole point of this file), so stats keep growing
 * monotonically over the lifetime of the install.
 *
 * Schema:
 *   - stat_sessions   : one row per top-level conversation ever started
 *                       (subagents are not recorded — they're not "sessions"
 *                       in the user-facing sense).
 *   - stat_messages   : one row per user message or per assistant turn.
 *                       Assistant rows are inserted at onFinish with the
 *                       actual token counts + resolved model_id; user rows
 *                       are inserted immediately on persist.
 *
 * We intentionally store the minimum data needed to power the dashboard:
 * timestamps, role, model, and token counts. No message text.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS stat_sessions (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stat_messages (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    message_id TEXT,
    role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
    model_id TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
    reasoning_tokens INTEGER,
    total_tokens INTEGER,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_stat_sessions_created ON stat_sessions(created_at);
CREATE INDEX IF NOT EXISTS idx_stat_messages_created ON stat_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_stat_messages_role_created ON stat_messages(role, created_at);
CREATE INDEX IF NOT EXISTS idx_stat_messages_model ON stat_messages(model_id);
`;

let statsDb: Database | null = null;

function ensureDir(dir: string): void {
    try {
        mkdirSync(dir, { recursive: true });
    } catch {
        // already exists
    }
}

export function getStatsDb(): Database {
    if (statsDb) return statsDb;

    const dbPath = getHomePath("stats.db");
    ensureDir(dirname(dbPath));

    const db = new Database(dbPath);
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec(SCHEMA);

    statsDb = db;
    return db;
}

export function closeStatsDb(): void {
    if (statsDb) {
        statsDb.close();
        statsDb = null;
    }
}
