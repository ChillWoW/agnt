import { api } from "@/lib/api";
import type {
    McpConfig,
    McpListResult,
    McpRawServerConfig,
    McpScope,
    McpServerInfo,
    McpTestResult
} from "./mcp-types";

function basePath(workspaceId: string): string {
    return `/workspaces/${workspaceId}/mcp`;
}

export function fetchMcpServers(workspaceId: string) {
    return api.get<McpListResult>(`${basePath(workspaceId)}/servers`);
}

export function fetchMcpConfig(workspaceId: string, scope: McpScope) {
    return api.get<McpConfig>(`${basePath(workspaceId)}/config/${scope}`);
}

export function writeMcpConfig(
    workspaceId: string,
    scope: McpScope,
    config: McpConfig
) {
    return api.put<McpListResult, McpConfig>(
        `${basePath(workspaceId)}/config/${scope}`,
        { body: config }
    );
}

export function refreshMcpServer(workspaceId: string, serverName: string) {
    return api.post<McpServerInfo>(
        `${basePath(workspaceId)}/servers/${serverName}/refresh`
    );
}

export function testMcpServer(
    workspaceId: string,
    server: McpRawServerConfig
) {
    return api.post<McpTestResult, McpRawServerConfig>(
        `${basePath(workspaceId)}/test`,
        { body: server }
    );
}
