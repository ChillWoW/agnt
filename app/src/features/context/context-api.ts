import { api } from "@/lib/api";
import type { CompactionResult, ContextSummary } from "./context-types";

export function fetchContextSummary(
    workspaceId: string,
    conversationId: string,
    signal?: AbortSignal
): Promise<ContextSummary> {
    return api.get<ContextSummary>(
        `/workspaces/${workspaceId}/conversations/${conversationId}/context`,
        { signal }
    );
}

export function compactConversation(
    workspaceId: string,
    conversationId: string
): Promise<CompactionResult> {
    return api.post<CompactionResult>(
        `/workspaces/${workspaceId}/conversations/${conversationId}/compact`
    );
}
