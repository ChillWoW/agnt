export type PermissionMode = "ask" | "bypass";

export type PermissionDecision = "allow_once" | "allow_session" | "deny";

export interface PermissionRequest {
    id: string;
    conversationId: string;
    messageId: string;
    toolName: string;
    input: unknown;
    createdAt: string;
}

export interface ToolCatalogEntry {
    name: string;
    description: string;
}
