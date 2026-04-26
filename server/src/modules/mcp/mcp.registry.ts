import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { logger } from "../../lib/logger";
import {
    hashNormalized,
    isErrorWithMessage,
    type McpNormalizedServer,
    type McpServerStatus,
    type McpToolDescriptor
} from "./mcp.types";

// ─── Per-workspace MCP registry ───────────────────────────────────────────────
//
// Maintains a `Client` per workspace + server-name. Clients are lazily
// connected on first use and reused across turns. A config-hash check on
// each acquire reconnects the client if its on-disk shape changed.
//
// Shutdown paths must call `disposeAll()` from `server/src/index.ts` so
// stdio child processes are reaped.

const CLIENT_INFO = {
    name: "agnt",
    version: "0.1.0"
} as const;

export interface McpServerHandle {
    serverName: string;
    workspaceId: string;
    normalized: McpNormalizedServer;
    configHash: string;
    status: McpServerStatus;
    error?: string;
    client?: Client;
    transport?: Transport;
    tools: McpToolDescriptor[];
    startedAt?: number;
}

const handles = new Map<string, Map<string, McpServerHandle>>();

function workspaceKey(workspaceId: string): Map<string, McpServerHandle> {
    let bucket = handles.get(workspaceId);
    if (!bucket) {
        bucket = new Map();
        handles.set(workspaceId, bucket);
    }
    return bucket;
}

function namespaceTool(serverName: string, toolName: string): string {
    return `mcp__${serverName}__${toolName}`;
}

function buildTransport(server: McpNormalizedServer): Transport {
    if (server.transport === "stdio") {
        return new StdioClientTransport({
            command: server.command,
            args: server.args,
            env: { ...process.env as Record<string, string>, ...server.env },
            cwd: server.cwd,
            stderr: "pipe"
        });
    }

    const url = new URL(server.url);
    const init: RequestInit | undefined = Object.keys(server.headers).length
        ? { headers: server.headers }
        : undefined;

    if (server.transport === "sse") {
        // NOTE: `requestInit.headers` are applied to the POST messages but
        // not to the initial SSE GET request (the EventSource has its own
        // request lifecycle). Users needing auth on the initial GET should
        // prefer the streamable HTTP transport instead.
        return new SSEClientTransport(url, {
            requestInit: init
        });
    }

    return new StreamableHTTPClientTransport(url, {
        requestInit: init
    });
}

async function connectHandle(handle: McpServerHandle): Promise<void> {
    handle.status = "starting";
    handle.error = undefined;

    const transport = buildTransport(handle.normalized);
    const client = new Client(CLIENT_INFO, {
        capabilities: {}
    });

    try {
        await client.connect(transport);
        const list = await client.listTools();

        handle.client = client;
        handle.transport = transport;
        handle.tools = list.tools.map((tool) => ({
            name: namespaceTool(handle.serverName, tool.name),
            rawName: tool.name,
            description: tool.description ?? "",
            inputSchema: tool.inputSchema as unknown
        }));
        handle.status = "ready";
        handle.startedAt = Date.now();

        logger.log("[mcp:registry] connected", {
            workspaceId: handle.workspaceId,
            server: handle.serverName,
            transport: handle.normalized.transport,
            tools: handle.tools.length
        });
    } catch (error) {
        handle.status = "error";
        handle.error = formatError(error);
        handle.tools = [];
        try {
            await client.close();
        } catch {
            // best-effort cleanup
        }
        try {
            await transport.close();
        } catch {
            // best-effort cleanup
        }
        logger.error("[mcp:registry] connect failed", {
            workspaceId: handle.workspaceId,
            server: handle.serverName,
            error: handle.error
        });
    }
}

async function closeHandle(handle: McpServerHandle): Promise<void> {
    const { client, transport } = handle;
    handle.client = undefined;
    handle.transport = undefined;
    handle.status = "disconnected";
    handle.tools = [];
    handle.startedAt = undefined;

    if (client) {
        try {
            await client.close();
        } catch (error) {
            logger.error("[mcp:registry] client close failed", {
                server: handle.serverName,
                error: formatError(error)
            });
        }
    }
    if (transport) {
        try {
            await transport.close();
        } catch (error) {
            logger.error("[mcp:registry] transport close failed", {
                server: handle.serverName,
                error: formatError(error)
            });
        }
    }
}

/**
 * Acquire a connected handle. Returns null when the server is disabled.
 * On config-hash drift the existing handle is closed and re-spawned.
 */
export async function acquireServer(
    workspaceId: string,
    serverName: string,
    normalized: McpNormalizedServer
): Promise<McpServerHandle> {
    const bucket = workspaceKey(workspaceId);
    const existing = bucket.get(serverName);
    const nextHash = hashNormalized(normalized);

    if (normalized.disabled) {
        if (existing && existing.status !== "disabled") {
            await closeHandle(existing);
        }
        const handle: McpServerHandle = existing ?? {
            serverName,
            workspaceId,
            normalized,
            configHash: nextHash,
            status: "disabled",
            tools: []
        };
        handle.normalized = normalized;
        handle.configHash = nextHash;
        handle.status = "disabled";
        handle.error = undefined;
        handle.tools = [];
        bucket.set(serverName, handle);
        return handle;
    }

    if (existing && existing.configHash === nextHash) {
        if (existing.status === "ready" || existing.status === "starting") {
            return existing;
        }
        if (existing.status === "error") {
            // Caller can decide whether to retry; we don't auto-reconnect on
            // every acquire because a busted config would burn tokens on
            // every turn.
            return existing;
        }
    }

    if (existing) {
        await closeHandle(existing);
    }

    const handle: McpServerHandle = {
        serverName,
        workspaceId,
        normalized,
        configHash: nextHash,
        status: "starting",
        tools: []
    };
    bucket.set(serverName, handle);
    await connectHandle(handle);
    return handle;
}

/**
 * Force a reconnect for a single server, regardless of config-hash.
 * Used by the "Refresh" button in the settings UI.
 */
export async function refreshServer(
    workspaceId: string,
    serverName: string,
    normalized: McpNormalizedServer
): Promise<McpServerHandle> {
    const bucket = workspaceKey(workspaceId);
    const existing = bucket.get(serverName);
    if (existing) {
        await closeHandle(existing);
    }

    if (normalized.disabled) {
        const handle: McpServerHandle = {
            serverName,
            workspaceId,
            normalized,
            configHash: hashNormalized(normalized),
            status: "disabled",
            tools: []
        };
        bucket.set(serverName, handle);
        return handle;
    }

    const handle: McpServerHandle = {
        serverName,
        workspaceId,
        normalized,
        configHash: hashNormalized(normalized),
        status: "starting",
        tools: []
    };
    bucket.set(serverName, handle);
    await connectHandle(handle);
    return handle;
}

export function getHandle(
    workspaceId: string,
    serverName: string
): McpServerHandle | undefined {
    return handles.get(workspaceId)?.get(serverName);
}

export function listHandles(workspaceId: string): McpServerHandle[] {
    const bucket = handles.get(workspaceId);
    if (!bucket) return [];
    return Array.from(bucket.values());
}

/**
 * Drop any handle whose server name no longer appears in `validNames`.
 * Used when the on-disk config removes a server: the in-memory client must
 * also be torn down so the spawned process exits.
 */
export async function pruneRemoved(
    workspaceId: string,
    validNames: ReadonlySet<string>
): Promise<void> {
    const bucket = handles.get(workspaceId);
    if (!bucket) return;

    const stale: string[] = [];
    for (const name of bucket.keys()) {
        if (!validNames.has(name)) stale.push(name);
    }

    for (const name of stale) {
        const handle = bucket.get(name);
        bucket.delete(name);
        if (handle) await closeHandle(handle);
    }
}

export async function disposeWorkspace(workspaceId: string): Promise<void> {
    const bucket = handles.get(workspaceId);
    if (!bucket) return;
    handles.delete(workspaceId);

    await Promise.all(
        Array.from(bucket.values()).map((handle) => closeHandle(handle))
    );
}

export async function disposeAll(): Promise<void> {
    const all: McpServerHandle[] = [];
    for (const bucket of handles.values()) {
        for (const handle of bucket.values()) {
            all.push(handle);
        }
    }
    handles.clear();

    await Promise.all(
        all.map(async (handle) => {
            try {
                await closeHandle(handle);
            } catch (error) {
                logger.error("[mcp:registry] disposeAll error", error);
            }
        })
    );
}

export async function callTool(
    handle: McpServerHandle,
    rawToolName: string,
    args: Record<string, unknown>,
    options?: { signal?: AbortSignal }
): Promise<unknown> {
    if (!handle.client) {
        throw new Error(
            `MCP server "${handle.serverName}" is not connected (status: ${handle.status}).`
        );
    }

    const result = await handle.client.callTool(
        {
            name: rawToolName,
            arguments: args
        },
        undefined,
        options?.signal ? { signal: options.signal } : undefined
    );

    if ("isError" in result && result.isError) {
        const text = extractErrorText(result.content);
        throw new Error(
            text ||
                `MCP server "${handle.serverName}" returned an error from tool "${rawToolName}".`
        );
    }

    return result;
}

function extractErrorText(content: unknown): string {
    if (!Array.isArray(content)) return "";
    return content
        .filter(
            (part): part is { type: "text"; text: string } =>
                typeof part === "object" &&
                part !== null &&
                (part as { type?: unknown }).type === "text" &&
                typeof (part as { text?: unknown }).text === "string"
        )
        .map((part) => part.text)
        .join("\n");
}

function formatError(error: unknown): string {
    if (isErrorWithMessage(error)) return error.message;
    return String(error);
}
