import { Elysia } from "elysia";
import {
    listServers,
    refreshServerByName,
    testServerConfig,
    loadConfig
} from "./mcp.service";
import { writeMcpConfig } from "./mcp.config";
import {
    isErrorWithMessage,
    mcpConfigSchema,
    rawMcpServerSchema,
    type McpScope
} from "./mcp.types";

// ─── MCP HTTP routes ──────────────────────────────────────────────────────────
//
// Exposes the MCP service to the Tauri frontend. All endpoints are scoped
// to a workspace because per-workspace project configs are part of the
// merged view, even though the global config is shared.

const VALID_SCOPES = new Set<McpScope>(["global", "project"]);

function isValidScope(value: unknown): value is McpScope {
    return typeof value === "string" && VALID_SCOPES.has(value as McpScope);
}

function formatError(error: unknown): string {
    if (isErrorWithMessage(error)) return error.message;
    return String(error);
}

const mcpRoutes = new Elysia({ prefix: "/workspaces/:id/mcp" })
    .get("/servers", async ({ params, set }) => {
        try {
            return await listServers(params.id);
        } catch (error) {
            set.status = 500;
            return { error: formatError(error) };
        }
    })
    .get("/config/:scope", ({ params, set }) => {
        if (!isValidScope(params.scope)) {
            set.status = 400;
            return { error: `Unknown scope "${params.scope}".` };
        }
        try {
            const config = loadConfig(params.id);
            return params.scope === "global" ? config.global : config.project;
        } catch (error) {
            set.status = 500;
            return { error: formatError(error) };
        }
    })
    .put("/config/:scope", async ({ params, body, set }) => {
        if (!isValidScope(params.scope)) {
            set.status = 400;
            return { error: `Unknown scope "${params.scope}".` };
        }

        const parsed = mcpConfigSchema.safeParse(body);
        if (!parsed.success) {
            set.status = 400;
            return {
                error: "Invalid MCP config payload.",
                issues: parsed.error.issues
            };
        }

        try {
            writeMcpConfig(params.scope, params.id, parsed.data);
            // Re-list immediately so the UI gets fresh status data without a
            // second roundtrip. Connections happen lazily inside listServers.
            return await listServers(params.id);
        } catch (error) {
            set.status = 500;
            return { error: formatError(error) };
        }
    })
    .post("/servers/:name/refresh", async ({ params, set }) => {
        try {
            return await refreshServerByName(params.id, params.name);
        } catch (error) {
            set.status = 400;
            return { error: formatError(error) };
        }
    })
    .post("/test", async ({ body, set }) => {
        const parsed = rawMcpServerSchema.safeParse(body);
        if (!parsed.success) {
            set.status = 400;
            return {
                error: "Invalid MCP server payload.",
                issues: parsed.error.issues
            };
        }
        try {
            return await testServerConfig(parsed.data);
        } catch (error) {
            set.status = 500;
            return { error: formatError(error) };
        }
    });

export default mcpRoutes;
