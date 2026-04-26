import { z } from "zod";

// ─── Config schemas ───────────────────────────────────────────────────────────
//
// The on-disk config follows the same `mcpServers` shape used by Claude
// Desktop, Cursor, and other MCP-aware clients so users can paste configs
// they already have. We accept both the modern `transport` key and the
// older `type` alias (Cursor convention). Transport is inferred when the
// caller leaves it off but provides a `command` (stdio) or a `url`
// (SSE / streamable HTTP).
//
// The raw schema is intentionally permissive so a single record can describe
// any transport. Use `normalizeServer` to project a raw entry into the
// per-transport runtime shape (with a concrete `transport` value).

export const MCP_SERVER_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

export const mcpServerNameSchema = z
    .string()
    .min(1)
    .regex(
        MCP_SERVER_NAME_PATTERN,
        "Server name must start with a letter and contain only letters, numbers, hyphens, or underscores."
    );

export const mcpTransportSchema = z.enum(["stdio", "sse", "http"]);

export const rawMcpServerSchema = z
    .object({
        transport: mcpTransportSchema.optional(),
        type: mcpTransportSchema.optional(),
        // stdio fields
        command: z.string().min(1).optional(),
        args: z.array(z.string()).optional(),
        env: z.record(z.string(), z.string()).optional(),
        cwd: z.string().optional(),
        // remote (sse/http) fields
        url: z.string().url().optional(),
        headers: z.record(z.string(), z.string()).optional(),
        // shared
        disabled: z.boolean().optional()
    })
    .strict();

export type RawMcpServer = z.infer<typeof rawMcpServerSchema>;

export const mcpConfigSchema = z.object({
    mcpServers: z.record(mcpServerNameSchema, rawMcpServerSchema).default({})
});

export type McpConfig = z.infer<typeof mcpConfigSchema>;

export const DEFAULT_MCP_CONFIG: McpConfig = { mcpServers: {} };

export type McpScope = "global" | "project";

// ─── Runtime/status types ─────────────────────────────────────────────────────

export type McpTransport = z.infer<typeof mcpTransportSchema>;

export type McpServerStatus =
    | "disconnected"
    | "starting"
    | "ready"
    | "error"
    | "disabled";

export interface McpStdioServerNormalized {
    transport: "stdio";
    command: string;
    args: string[];
    env: Record<string, string>;
    cwd?: string;
    disabled: boolean;
}

export interface McpRemoteServerNormalized {
    transport: "sse" | "http";
    url: string;
    headers: Record<string, string>;
    disabled: boolean;
}

export type McpNormalizedServer =
    | McpStdioServerNormalized
    | McpRemoteServerNormalized;

export interface McpToolDescriptor {
    name: string; // namespaced: mcp__<server>__<tool>
    rawName: string; // original tool name as advertised by the server
    description: string;
    inputSchema: unknown; // raw JSON schema as advertised by the server
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

/**
 * Resolve the transport for a raw config entry. Defaults to whatever the
 * caller spelled (`transport` wins over `type`); falls back to stdio if the
 * entry has a command, otherwise http.
 */
export function inferTransport(raw: RawMcpServer): McpTransport {
    const t = raw.transport ?? raw.type;
    if (t) return t;
    if (raw.command) return "stdio";
    if (raw.url) return "http";
    return "stdio";
}

/**
 * Project a raw config entry into the per-transport runtime shape. Throws
 * with a human-readable message when required fields for the resolved
 * transport are missing.
 */
export function normalizeServer(raw: RawMcpServer): McpNormalizedServer {
    const transport = inferTransport(raw);
    const disabled = Boolean(raw.disabled);

    if (transport === "stdio") {
        if (!raw.command) {
            throw new Error("stdio MCP servers require a `command` field.");
        }
        return {
            transport: "stdio",
            command: raw.command,
            args: raw.args ?? [],
            env: raw.env ?? {},
            cwd: raw.cwd,
            disabled
        };
    }

    if (!raw.url) {
        throw new Error(
            `${transport} MCP servers require a \`url\` field.`
        );
    }

    return {
        transport,
        url: raw.url,
        headers: raw.headers ?? {},
        disabled
    };
}

/**
 * Hash a normalized server entry so the registry can detect when a config
 * change should force a reconnect. Stable JSON stringification (key sort)
 * is good enough — entries are small and we just need exact equality.
 */
export function hashNormalized(server: McpNormalizedServer): string {
    return stableStringify(server);
}

export function isErrorWithMessage(
    value: unknown
): value is { message: string } {
    return (
        typeof value === "object" &&
        value !== null &&
        "message" in value &&
        typeof (value as { message: unknown }).message === "string"
    );
}

function stableStringify(value: unknown): string {
    if (value === null || typeof value !== "object") {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(",")}]`;
    }
    const entries = Object.entries(value as Record<string, unknown>).sort(
        ([a], [b]) => a.localeCompare(b)
    );
    return `{${entries
        .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
        .join(",")}}`;
}
