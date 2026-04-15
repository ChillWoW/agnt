import { api } from "@/lib/api";
import type {
    EffectiveConversationState,
    HistoryEntry,
    ScopeState
} from "./history-types";

type StatePayload = {
    values: Record<string, unknown>;
    source?: string;
};

type HistoryPayload = {
    key: string;
    value: unknown;
    source?: string;
};

export function fetchWorkspaceState(workspaceId: string) {
    return api.get<ScopeState>(`/workspaces/${workspaceId}/state`);
}

export function updateWorkspaceState(workspaceId: string, payload: StatePayload) {
    return api.patch<ScopeState>(`/workspaces/${workspaceId}/state`, { body: payload });
}

export function fetchWorkspaceHistory(workspaceId: string, key?: string) {
    const suffix = key ? `?key=${encodeURIComponent(key)}` : "";
    return api.get<HistoryEntry[]>(`/workspaces/${workspaceId}/history${suffix}`);
}

export function appendWorkspaceHistory(workspaceId: string, payload: HistoryPayload) {
    return api.post<HistoryEntry>(`/workspaces/${workspaceId}/history`, { body: payload });
}

export function fetchConversationState(workspaceId: string, conversationId: string) {
    return api.get<ScopeState>(
        `/workspaces/${workspaceId}/conversations/${conversationId}/state`
    );
}

export function updateConversationState(
    workspaceId: string,
    conversationId: string,
    payload: StatePayload
) {
    return api.patch<ScopeState>(
        `/workspaces/${workspaceId}/conversations/${conversationId}/state`,
        { body: payload }
    );
}

export function fetchEffectiveConversationState(
    workspaceId: string,
    conversationId: string
) {
    return api.get<EffectiveConversationState>(
        `/workspaces/${workspaceId}/conversations/${conversationId}/state/effective`
    );
}

export function fetchConversationHistory(
    workspaceId: string,
    conversationId: string,
    key?: string
) {
    const suffix = key ? `?key=${encodeURIComponent(key)}` : "";
    return api.get<HistoryEntry[]>(
        `/workspaces/${workspaceId}/conversations/${conversationId}/history${suffix}`
    );
}

export function appendConversationHistory(
    workspaceId: string,
    conversationId: string,
    payload: HistoryPayload
) {
    return api.post<HistoryEntry>(
        `/workspaces/${workspaceId}/conversations/${conversationId}/history`,
        { body: payload }
    );
}
