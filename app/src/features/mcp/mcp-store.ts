import { create } from "zustand";
import { toApiErrorMessage } from "@/lib/api";
import * as mcpApi from "./mcp-api";
import type {
    McpConfig,
    McpListResult,
    McpRawServerConfig,
    McpScope,
    McpServerInfo,
    McpTestResult
} from "./mcp-types";

interface McpState {
    workspaceId: string | null;
    data: McpListResult | null;
    isLoading: boolean;
    isSaving: boolean;
    error: string | null;

    load: (workspaceId: string, options?: { force?: boolean }) => Promise<void>;
    saveConfig: (
        workspaceId: string,
        scope: McpScope,
        config: McpConfig
    ) => Promise<void>;
    upsertServer: (
        workspaceId: string,
        scope: McpScope,
        name: string,
        server: McpRawServerConfig
    ) => Promise<void>;
    deleteServer: (
        workspaceId: string,
        scope: McpScope,
        name: string
    ) => Promise<void>;
    setServerDisabled: (
        workspaceId: string,
        scope: McpScope,
        name: string,
        disabled: boolean
    ) => Promise<void>;
    refreshServer: (
        workspaceId: string,
        name: string
    ) => Promise<McpServerInfo | null>;
    testServer: (
        workspaceId: string,
        server: McpRawServerConfig
    ) => Promise<McpTestResult>;
}

export const useMcpStore = create<McpState>((set, get) => ({
    workspaceId: null,
    data: null,
    isLoading: false,
    isSaving: false,
    error: null,

    load: async (workspaceId, options) => {
        const force = options?.force ?? false;
        const state = get();
        if (
            !force &&
            state.workspaceId === workspaceId &&
            state.data &&
            !state.isLoading
        ) {
            return;
        }

        set({ isLoading: true, workspaceId, error: null });
        try {
            const data = await mcpApi.fetchMcpServers(workspaceId);
            set({ data, isLoading: false });
        } catch (error) {
            set({
                error: toApiErrorMessage(error, "Failed to load MCP servers"),
                isLoading: false
            });
        }
    },

    saveConfig: async (workspaceId, scope, config) => {
        set({ isSaving: true, error: null });
        try {
            const data = await mcpApi.writeMcpConfig(
                workspaceId,
                scope,
                config
            );
            set({ data, isSaving: false });
        } catch (error) {
            set({
                error: toApiErrorMessage(error, "Failed to save MCP config"),
                isSaving: false
            });
            throw error;
        }
    },

    upsertServer: async (workspaceId, scope, name, server) => {
        const current = await mcpApi.fetchMcpConfig(workspaceId, scope);
        const next: McpConfig = {
            mcpServers: {
                ...current.mcpServers,
                [name]: server
            }
        };
        await get().saveConfig(workspaceId, scope, next);
    },

    deleteServer: async (workspaceId, scope, name) => {
        const current = await mcpApi.fetchMcpConfig(workspaceId, scope);
        const next: Record<string, McpRawServerConfig> = {
            ...current.mcpServers
        };
        delete next[name];
        await get().saveConfig(workspaceId, scope, { mcpServers: next });
    },

    setServerDisabled: async (workspaceId, scope, name, disabled) => {
        const current = await mcpApi.fetchMcpConfig(workspaceId, scope);
        const existing = current.mcpServers[name];
        if (!existing) return;
        const next: McpConfig = {
            mcpServers: {
                ...current.mcpServers,
                [name]: { ...existing, disabled }
            }
        };
        await get().saveConfig(workspaceId, scope, next);
    },

    refreshServer: async (workspaceId, name) => {
        try {
            const updated = await mcpApi.refreshMcpServer(workspaceId, name);
            // Update only the matching server entry; everything else stays.
            const data = get().data;
            if (data) {
                const servers = data.servers.map((server) =>
                    server.name === updated.name ? updated : server
                );
                set({ data: { ...data, servers } });
            }
            return updated;
        } catch (error) {
            set({
                error: toApiErrorMessage(error, "Failed to refresh MCP server")
            });
            return null;
        }
    },

    testServer: async (workspaceId, server) => {
        return mcpApi.testMcpServer(workspaceId, server);
    }
}));
