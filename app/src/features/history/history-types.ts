export type HistoryScope = "workspace" | "conversation";

export interface HistoryEntry {
    id: string;
    scopeType: HistoryScope;
    scopeId: string;
    key: string;
    value: unknown;
    source: string | null;
    createdAt: string;
}

export interface ScopeState {
    scopeType: HistoryScope;
    scopeId: string;
    values: Record<string, unknown>;
    updatedAt: string | null;
}

export interface EffectiveConversationState {
    workspace: ScopeState;
    conversation: ScopeState;
    merged: Record<string, unknown>;
}
