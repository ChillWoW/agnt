import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { logger } from "../../lib/logger";
import { getHomePath } from "../../lib/homedir";
import { getWorkspace } from "../workspaces/workspaces.service";
import {
    DEFAULT_MCP_CONFIG,
    inferTransport,
    isErrorWithMessage,
    mcpConfigSchema,
    normalizeServer,
    type McpConfig,
    type McpNormalizedServer,
    type McpScope,
    type RawMcpServer
} from "./mcp.types";

// ─── Config discovery ─────────────────────────────────────────────────────────
//
// Two scopes mirror the skills module:
//   - global:  ~/.agnt/mcp.json
//   - project: <workspace>/.agnt/mcp.json
//
// Project entries override global on name collision so a workspace can
// shadow a personal default. `loadMcpConfig` returns both raw configs and
// the merged + normalized view.

const GLOBAL_FILENAME = "mcp.json";
const PROJECT_DIRNAME = ".agnt";

export interface ResolvedMcpServer {
    name: string;
    scope: McpScope;
    raw: RawMcpServer;
    normalized: McpNormalizedServer;
    parseError?: string;
}

export interface LoadedMcpConfig {
    workspacePath: string;
    globalPath: string;
    projectPath: string;
    global: McpConfig;
    project: McpConfig;
    /** Servers merged across scopes; project entries override global on collision. */
    servers: ResolvedMcpServer[];
    warnings: string[];
}

export function getGlobalMcpConfigPath(): string {
    return getHomePath(GLOBAL_FILENAME);
}

export function getProjectMcpConfigPath(workspacePath: string): string {
    return join(workspacePath, PROJECT_DIRNAME, GLOBAL_FILENAME);
}

function ensureDir(dir: string): void {
    try {
        mkdirSync(dir, { recursive: true });
    } catch {
        // already exists
    }
}

function safeReadFile(path: string): string | null {
    try {
        if (!existsSync(path)) return null;
        return readFileSync(path, "utf8");
    } catch (error) {
        logger.error("[mcp:config] read failed", { path, error });
        return null;
    }
}

function parseConfigFile(
    path: string,
    warnings: string[]
): McpConfig {
    const raw = safeReadFile(path);
    if (raw === null || raw.trim().length === 0) {
        return { ...DEFAULT_MCP_CONFIG };
    }

    let json: unknown;
    try {
        json = JSON.parse(raw);
    } catch (error) {
        warnings.push(
            `Failed to parse ${path}: ${formatError(error)}. Ignoring this config file.`
        );
        return { ...DEFAULT_MCP_CONFIG };
    }

    // Tolerate users dropping the `mcpServers` wrapper.
    const candidate =
        json && typeof json === "object" && !Array.isArray(json)
            ? "mcpServers" in (json as Record<string, unknown>)
                ? json
                : { mcpServers: json }
            : { mcpServers: {} };

    const parsed = mcpConfigSchema.safeParse(candidate);
    if (!parsed.success) {
        warnings.push(
            `Invalid MCP config at ${path}: ${parsed.error.issues
                .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
                .join("; ")}`
        );
        return { ...DEFAULT_MCP_CONFIG };
    }

    return parsed.data;
}

export function readGlobalMcpConfig(warnings: string[]): McpConfig {
    return parseConfigFile(getGlobalMcpConfigPath(), warnings);
}

export function readProjectMcpConfig(
    workspacePath: string,
    warnings: string[]
): McpConfig {
    if (!workspacePath) return { ...DEFAULT_MCP_CONFIG };
    return parseConfigFile(
        getProjectMcpConfigPath(workspacePath),
        warnings
    );
}

/**
 * Load global + project configs and merge them into a flat array of
 * `ResolvedMcpServer` entries. Servers that fail per-entry normalization
 * (e.g. a stdio entry missing `command`) are still returned with a
 * `parseError` so the settings UI can surface the issue without throwing.
 */
export function loadMcpConfig(workspaceId: string): LoadedMcpConfig {
    const warnings: string[] = [];
    let workspacePath = "";
    try {
        workspacePath = getWorkspace(workspaceId).path;
    } catch (error) {
        warnings.push(
            `Could not resolve workspace ${workspaceId}: ${formatError(error)}`
        );
    }

    const globalConfig = readGlobalMcpConfig(warnings);
    const projectConfig = readProjectMcpConfig(workspacePath, warnings);

    const merged = new Map<string, ResolvedMcpServer>();

    const ingest = (config: McpConfig, scope: McpScope) => {
        for (const [name, raw] of Object.entries(config.mcpServers)) {
            try {
                const normalized = normalizeServer(raw);
                merged.set(name, { name, scope, raw, normalized });
            } catch (error) {
                const message = formatError(error);
                warnings.push(
                    `Skipping ${scope} MCP server "${name}": ${message}`
                );
                merged.set(name, {
                    name,
                    scope,
                    raw,
                    // Stub a normalized entry so the UI can render the row;
                    // registry won't connect because parseError is set.
                    normalized: {
                        transport: inferTransport(raw),
                        // The cast below is safe because we always early-return
                        // on parseError before touching these fields.
                        command: "",
                        args: [],
                        env: {},
                        url: "",
                        headers: {},
                        disabled: Boolean(raw.disabled)
                    } as McpNormalizedServer,
                    parseError: message
                });
            }
        }
    };

    ingest(globalConfig, "global");
    ingest(projectConfig, "project"); // project overrides global on collision

    return {
        workspacePath,
        globalPath: getGlobalMcpConfigPath(),
        projectPath: workspacePath
            ? getProjectMcpConfigPath(workspacePath)
            : "",
        global: globalConfig,
        project: projectConfig,
        servers: Array.from(merged.values()).sort((a, b) =>
            a.name.localeCompare(b.name)
        ),
        warnings
    };
}

/**
 * Persist a config to disk. Validates the entire payload before writing so
 * a malformed shape never overwrites a working file.
 */
export function writeMcpConfig(
    scope: McpScope,
    workspaceId: string,
    config: McpConfig
): void {
    const parsed = mcpConfigSchema.parse(config);

    let path: string;
    if (scope === "global") {
        path = getGlobalMcpConfigPath();
    } else {
        const workspace = getWorkspace(workspaceId);
        path = getProjectMcpConfigPath(workspace.path);
    }

    ensureDir(dirname(path));
    writeFileSync(path, JSON.stringify(parsed, null, 4), "utf8");
    logger.log("[mcp:config] wrote", { scope, path });
}

function formatError(error: unknown): string {
    if (isErrorWithMessage(error)) return error.message;
    return String(error);
}
