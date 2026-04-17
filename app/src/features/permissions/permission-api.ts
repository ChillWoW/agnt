import { api } from "@/lib/api";
import type { PermissionDecision, ToolCatalogEntry } from "./types";

export function respondToPermission(
    workspaceId: string,
    conversationId: string,
    requestId: string,
    decision: PermissionDecision
) {
    return api.post<{ success: boolean }>(
        `/workspaces/${workspaceId}/conversations/${conversationId}/permissions/${requestId}/respond`,
        { body: { decision } }
    );
}

export function fetchTools() {
    return api.get<ToolCatalogEntry[]>("/tools");
}
