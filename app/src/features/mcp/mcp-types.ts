// Shared MCP types kept in sync with `server/src/modules/mcp/mcp.types.ts`.
// Duplicated rather than imported because the frontend can't reach into
// the server source folder.

export type McpScope = "global" | "project";
export type McpTransport = "stdio" | "sse" | "http";
export type McpServerStatus =
    | "disconnected"
    | "starting"
    | "ready"
    | "error"
    | "disabled";

export interface McpToolDescriptor {
    name: string;
    rawName: string;
    description: string;
    inputSchema: unknown;
}

export interface McpServerInfo {
    name: string;
    scope: McpScope;
    transport: McpTransport;
    status: McpServerStatus;
    disabled: boolean;
    error?: string;
    toolCount: number;
    tools: McpToolDescriptor[];
    startedAt?: number;
}

export interface McpListResult {
    workspaceId: string;
    workspacePath: string;
    globalConfigPath: string;
    projectConfigPath: string;
    servers: McpServerInfo[];
    warnings: string[];
}

export interface McpRawServerConfig {
    transport?: McpTransport;
    type?: McpTransport;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    cwd?: string;
    url?: string;
    headers?: Record<string, string>;
    disabled?: boolean;
}

export interface McpConfig {
    mcpServers: Record<string, McpRawServerConfig>;
}

export interface McpTestResult {
    ok: boolean;
    transport: string;
    toolCount: number;
    tools: { name: string; description: string }[];
    error?: string;
}

export const MCP_SERVER_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

export function inferTransport(raw: McpRawServerConfig): McpTransport {
    const t = raw.transport ?? raw.type;
    if (t) return t;
    if (raw.command) return "stdio";
    if (raw.url) return "http";
    return "stdio";
}
