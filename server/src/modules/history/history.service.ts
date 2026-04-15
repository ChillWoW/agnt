import { getWorkspaceDb } from "../../lib/db";
import type {
    EffectiveConversationState,
    HistoryEntry,
    HistoryScope,
    ScopeState
} from "./history.types";

type StateEntryRow = {
    key: string;
    value_json: string;
    updated_at: string;
};

type HistoryEntryRow = {
    id: string;
    scope_type: HistoryScope;
    scope_id: string;
    key: string;
    value_json: string;
    source: string | null;
    created_at: string;
};

type ScopeUpdate = {
    key: string;
    value: unknown;
};

function parseValue(valueJson: string): unknown {
    return JSON.parse(valueJson);
}

function stringifyValue(value: unknown): string {
    return JSON.stringify(value ?? null);
}

function ensureConversationExists(workspaceId: string, conversationId: string): void {
    const db = getWorkspaceDb(workspaceId);
    const conversation = db
        .query("SELECT id FROM conversations WHERE id = ?")
        .get(conversationId);

    if (!conversation) {
        throw new Error(`Conversation not found: ${conversationId}`);
    }
}

function ensureScopeExists(
    workspaceId: string,
    scopeType: HistoryScope,
    scopeId: string
): void {
    if (scopeType === "workspace") {
        return;
    }

    ensureConversationExists(workspaceId, scopeId);
}

function mapState(scopeType: HistoryScope, scopeId: string, rows: StateEntryRow[]): ScopeState {
    const values: Record<string, unknown> = {};
    let updatedAt: string | null = null;

    for (const row of rows) {
        values[row.key] = parseValue(row.value_json);

        if (!updatedAt || row.updated_at > updatedAt) {
            updatedAt = row.updated_at;
        }
    }

    return {
        scopeType,
        scopeId,
        values,
        updatedAt
    };
}

export function getScopeState(
    workspaceId: string,
    scopeType: HistoryScope,
    scopeId: string
): ScopeState {
    ensureScopeExists(workspaceId, scopeType, scopeId);

    const db = getWorkspaceDb(workspaceId);
    const rows = db
        .query(
            "SELECT key, value_json, updated_at FROM state_entries WHERE scope_type = ? AND scope_id = ? ORDER BY updated_at DESC"
        )
        .all(scopeType, scopeId) as StateEntryRow[];

    return mapState(scopeType, scopeId, rows);
}

export function listScopeHistory(
    workspaceId: string,
    scopeType: HistoryScope,
    scopeId: string,
    key?: string
): HistoryEntry[] {
    ensureScopeExists(workspaceId, scopeType, scopeId);

    const db = getWorkspaceDb(workspaceId);
    const rows = key
        ? ((db
              .query(
                  "SELECT id, scope_type, scope_id, key, value_json, source, created_at FROM history_entries WHERE scope_type = ? AND scope_id = ? AND key = ? ORDER BY created_at DESC"
              )
              .all(scopeType, scopeId, key) as HistoryEntryRow[]))
        : ((db
              .query(
                  "SELECT id, scope_type, scope_id, key, value_json, source, created_at FROM history_entries WHERE scope_type = ? AND scope_id = ? ORDER BY created_at DESC"
              )
              .all(scopeType, scopeId) as HistoryEntryRow[]));

    return rows.map((row) => ({
        id: row.id,
        scopeType: row.scope_type,
        scopeId: row.scope_id,
        key: row.key,
        value: parseValue(row.value_json),
        source: row.source,
        createdAt: row.created_at
    }));
}

export function appendScopeHistory(
    workspaceId: string,
    scopeType: HistoryScope,
    scopeId: string,
    update: ScopeUpdate,
    source?: string | null
): HistoryEntry {
    ensureScopeExists(workspaceId, scopeType, scopeId);

    const db = getWorkspaceDb(workspaceId);
    const entryId = crypto.randomUUID();
    const now = new Date().toISOString();
    const valueJson = stringifyValue(update.value);

    const tx = db.transaction(() => {
        db.query(
            "INSERT INTO history_entries (id, scope_type, scope_id, key, value_json, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
        ).run(entryId, scopeType, scopeId, update.key, valueJson, source ?? null, now);

        db.query(
            "INSERT INTO state_entries (scope_type, scope_id, key, value_json, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(scope_type, scope_id, key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at"
        ).run(scopeType, scopeId, update.key, valueJson, now);
    });

    tx();

    return {
        id: entryId,
        scopeType,
        scopeId,
        key: update.key,
        value: update.value ?? null,
        source: source ?? null,
        createdAt: now
    };
}

export function mergeScopeState(
    workspaceId: string,
    scopeType: HistoryScope,
    scopeId: string,
    values: Record<string, unknown>,
    source?: string | null
): ScopeState {
    const entries = Object.entries(values);

    for (const [key, value] of entries) {
        appendScopeHistory(workspaceId, scopeType, scopeId, { key, value }, source);
    }

    return getScopeState(workspaceId, scopeType, scopeId);
}

export function getEffectiveConversationState(
    workspaceId: string,
    conversationId: string
): EffectiveConversationState {
    ensureConversationExists(workspaceId, conversationId);

    const workspace = getScopeState(workspaceId, "workspace", workspaceId);
    const conversation = getScopeState(workspaceId, "conversation", conversationId);

    return {
        workspace,
        conversation,
        merged: {
            ...workspace.values,
            ...conversation.values
        }
    };
}
