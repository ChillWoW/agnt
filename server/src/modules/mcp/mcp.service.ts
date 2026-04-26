import { jsonSchema } from "@ai-sdk/provider-utils";
import type { JSONSchema7 } from "@ai-sdk/provider";
import { logger } from "../../lib/logger";
import type { ToolDefinition, ToolModelOutput } from "../conversations/tools/types";
import {
    loadMcpConfig,
    type LoadedMcpConfig,
    type ResolvedMcpServer
} from "./mcp.config";
import {
    acquireServer,
    callTool,
    disposeAll as registryDisposeAll,
    disposeWorkspace as registryDisposeWorkspace,
    listHandles,
    pruneRemoved,
    refreshServer as registryRefreshServer,
    type McpServerHandle
} from "./mcp.registry";
import {
    isErrorWithMessage,
    normalizeServer,
    type McpListResult,
    type McpScope,
    type McpServerInfo,
    type McpToolDescriptor,
    type RawMcpServer
} from "./mcp.types";

// ─── Public MCP service ───────────────────────────────────────────────────────
//
// Thin facade over the registry. The conversation stream calls
// `getMcpToolDefs` once per turn; the settings UI calls `listServers` /
// `refreshServer` / `testServerConfig`.

export interface ListServersOptions {
    /** Skip lazy-connecting servers that haven't been touched yet. */
    connect?: boolean;
}

/**
 * Build a `McpListResult` snapshot. When `connect` is true (default), every
 * non-disabled server in the merged config is lazily connected so the UI
 * can render real tool counts. When false, only already-known handles are
 * inspected.
 */
export async function listServers(
    workspaceId: string,
    options: ListServersOptions = {}
): Promise<McpListResult> {
    const config = loadMcpConfig(workspaceId);
    const servers: McpServerInfo[] = [];

    if (options.connect ?? true) {
        await pruneRemoved(
            workspaceId,
            new Set(config.servers.map((s) => s.name))
        );

        for (const entry of config.servers) {
            servers.push(
                await resolveServerInfo(workspaceId, entry, config.warnings)
            );
        }
    } else {
        for (const entry of config.servers) {
            const handle = listHandles(workspaceId).find(
                (h) => h.serverName === entry.name
            );
            servers.push(buildInfo(entry, handle));
        }
    }

    return {
        workspaceId,
        workspacePath: config.workspacePath,
        globalConfigPath: config.globalPath,
        projectConfigPath: config.projectPath,
        servers,
        warnings: config.warnings
    };
}

async function resolveServerInfo(
    workspaceId: string,
    entry: ResolvedMcpServer,
    warnings: string[]
): Promise<McpServerInfo> {
    if (entry.parseError) {
        warnings.push(
            `MCP server "${entry.name}" has an invalid config: ${entry.parseError}`
        );
        return {
            name: entry.name,
            scope: entry.scope,
            transport: entry.normalized.transport,
            status: "error",
            disabled: entry.normalized.disabled,
            error: entry.parseError,
            toolCount: 0,
            tools: []
        };
    }

    const handle = await acquireServer(
        workspaceId,
        entry.name,
        entry.normalized
    );

    return buildInfo(entry, handle);
}

function buildInfo(
    entry: ResolvedMcpServer,
    handle: McpServerHandle | undefined
): McpServerInfo {
    return {
        name: entry.name,
        scope: entry.scope,
        transport: entry.normalized.transport,
        status: handle?.status ?? "disconnected",
        disabled: entry.normalized.disabled,
        error: handle?.error ?? entry.parseError,
        toolCount: handle?.tools.length ?? 0,
        tools: handle?.tools ?? [],
        startedAt: handle?.startedAt
    };
}

/**
 * Lazily connect every enabled MCP server in the workspace's merged config
 * and return them as `ToolDefinition`s ready to feed
 * `buildConversationTools`. Servers that fail to connect are skipped (and
 * already logged once on the first failed acquire).
 */
export async function getMcpToolDefs(
    workspaceId: string
): Promise<ToolDefinition[]> {
    const config = loadMcpConfig(workspaceId);
    if (config.servers.length === 0) return [];

    await pruneRemoved(
        workspaceId,
        new Set(config.servers.map((s) => s.name))
    );

    const tools: ToolDefinition[] = [];

    for (const entry of config.servers) {
        if (entry.parseError) continue;
        if (entry.normalized.disabled) continue;

        let handle: McpServerHandle;
        try {
            handle = await acquireServer(
                workspaceId,
                entry.name,
                entry.normalized
            );
        } catch (error) {
            logger.error("[mcp:service] acquireServer failed", {
                server: entry.name,
                error: formatError(error)
            });
            continue;
        }

        if (handle.status !== "ready") continue;

        for (const descriptor of handle.tools) {
            tools.push(buildToolDefinition(handle, descriptor));
        }
    }

    return tools;
}

/**
 * List MCP tool descriptors WITHOUT calling `buildToolDefinition`. Used by
 * the settings UI's "MCP" tool-permissions category, which only needs
 * names + descriptions.
 */
export async function listMcpToolDescriptors(
    workspaceId: string
): Promise<McpToolDescriptor[]> {
    const result = await listServers(workspaceId, { connect: true });
    const out: McpToolDescriptor[] = [];
    for (const server of result.servers) {
        for (const tool of server.tools) {
            out.push(tool);
        }
    }
    return out;
}

function buildToolDefinition(
    handle: McpServerHandle,
    descriptor: McpToolDescriptor
): ToolDefinition {
    const schema = jsonSchema(
        (descriptor.inputSchema as JSONSchema7) ?? {
            type: "object",
            properties: {},
            additionalProperties: true
        }
    );

    const def: ToolDefinition = {
        name: descriptor.name,
        description:
            descriptor.description ||
            `Tool "${descriptor.rawName}" provided by MCP server "${handle.serverName}".`,
        // The conversation tools layer expects a `z.ZodType` for inputSchema.
        // The AI SDK's `dynamicTool` accepts `FlexibleSchema` which includes
        // both Zod schemas and `jsonSchema()` results. We cast here because
        // the rest of the pipeline only forwards the schema to the SDK,
        // never invokes `.parse()` on it directly.
        inputSchema: schema as never,
        execute: async (input, ctx) => {
            const args = (input ?? {}) as Record<string, unknown>;
            const result = await callTool(handle, descriptor.rawName, args, {
                signal: ctx?.abortSignal
            });
            return result;
        },
        toModelOutput: ({ output }) => mapMcpResultToModelOutput(output)
    };

    return def;
}

interface McpCallToolContent {
    type: string;
    text?: string;
    data?: string;
    mimeType?: string;
}

function mapMcpResultToModelOutput(output: unknown): ToolModelOutput {
    if (!output || typeof output !== "object") {
        return { type: "json", value: output };
    }

    const result = output as {
        content?: McpCallToolContent[];
        structuredContent?: unknown;
        toolResult?: unknown;
    };

    // Compatibility: some servers return `toolResult` instead of
    // `content` (older SDKs). Treat that as JSON.
    if (result.toolResult !== undefined && !result.content) {
        return { type: "json", value: result.toolResult };
    }

    if (!Array.isArray(result.content)) {
        return { type: "json", value: output };
    }

    // Fold all parts into a single content payload. Text parts get
    // concatenated; image/file parts are forwarded as data URIs the model
    // can render.
    const parts: Array<
        | { type: "text"; text: string }
        | { type: "image-data"; data: string; mediaType: string }
        | { type: "file-data"; data: string; mediaType: string }
    > = [];

    for (const item of result.content) {
        if (item.type === "text" && typeof item.text === "string") {
            parts.push({ type: "text", text: item.text });
            continue;
        }
        if (
            item.type === "image" &&
            typeof item.data === "string" &&
            typeof item.mimeType === "string"
        ) {
            parts.push({
                type: "image-data",
                data: item.data,
                mediaType: item.mimeType
            });
            continue;
        }
        if (
            item.type === "audio" &&
            typeof item.data === "string" &&
            typeof item.mimeType === "string"
        ) {
            parts.push({
                type: "file-data",
                data: item.data,
                mediaType: item.mimeType
            });
            continue;
        }
        // resource / resource_link: stringify and surface as text so the
        // model still sees them, even if it can't render the body.
        parts.push({
            type: "text",
            text: JSON.stringify(item)
        });
    }

    if (parts.length === 0) {
        return { type: "json", value: output };
    }

    if (parts.every((part) => part.type === "text")) {
        return {
            type: "text",
            value: (parts as { type: "text"; text: string }[])
                .map((p) => p.text)
                .join("\n\n")
        };
    }

    return { type: "content", value: parts };
}

/**
 * Force a reconnect for one server. Reads the current config so the new
 * client always reflects the latest disk state.
 */
export async function refreshServerByName(
    workspaceId: string,
    serverName: string
): Promise<McpServerInfo> {
    const config = loadMcpConfig(workspaceId);
    const entry = config.servers.find((s) => s.name === serverName);
    if (!entry) {
        throw new Error(
            `MCP server "${serverName}" is not in the merged config for this workspace.`
        );
    }
    if (entry.parseError) {
        throw new Error(
            `MCP server "${serverName}" has an invalid config: ${entry.parseError}`
        );
    }

    const handle = await registryRefreshServer(
        workspaceId,
        serverName,
        entry.normalized
    );
    return buildInfo(entry, handle);
}

export interface TestServerConfigResult {
    ok: boolean;
    transport: McpScope | string;
    toolCount: number;
    tools: { name: string; description: string }[];
    error?: string;
}

/**
 * Validate + ephemerally connect a config to make sure it works. The
 * resulting client is always closed before this function returns, so
 * nothing is registered.
 */
export async function testServerConfig(
    raw: RawMcpServer
): Promise<TestServerConfigResult> {
    let normalized;
    try {
        normalized = normalizeServer(raw);
    } catch (error) {
        return {
            ok: false,
            transport: "?",
            toolCount: 0,
            tools: [],
            error: formatError(error)
        };
    }

    const tempWorkspaceId = `__mcp_test__${Math.random()
        .toString(36)
        .slice(2, 10)}`;
    const tempName = "candidate";
    // Use a synthetic workspace id so the registry isolates this connect
    // from any real workspace state. Tear it down unconditionally.
    const handle = await acquireServer(tempWorkspaceId, tempName, {
        ...normalized,
        disabled: false
    });

    try {
        if (handle.status === "ready") {
            return {
                ok: true,
                transport: handle.normalized.transport,
                toolCount: handle.tools.length,
                tools: handle.tools.map((t) => ({
                    name: t.rawName,
                    description: t.description
                }))
            };
        }
        return {
            ok: false,
            transport: handle.normalized.transport,
            toolCount: 0,
            tools: [],
            error: handle.error ?? "Connection failed."
        };
    } finally {
        await registryDisposeWorkspace(tempWorkspaceId).catch(() => undefined);
    }
}

/**
 * Drop everything the registry knows about a workspace. Called by
 * `removeWorkspace` so stdio child processes don't leak when the user
 * unmounts a workspace.
 */
export async function disposeWorkspaceMcp(workspaceId: string): Promise<void> {
    await registryDisposeWorkspace(workspaceId);
}

/**
 * Tear everything down. Called from server shutdown.
 */
export async function disposeAllMcp(): Promise<void> {
    await registryDisposeAll();
}

/**
 * Re-export for callers that need the raw loaded config (settings UI).
 */
export function loadConfig(workspaceId: string): LoadedMcpConfig {
    return loadMcpConfig(workspaceId);
}

function formatError(error: unknown): string {
    if (isErrorWithMessage(error)) return error.message;
    return String(error);
}
