import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { getHomePath } from "../../lib/homedir";
import {
    workspacesRegistrySchema,
    DEFAULT_REGISTRY,
    type Workspace,
    type WorkspacesRegistry
} from "./workspaces.types";

const REGISTRY_PATH = getHomePath("workspaces.json");
const WORKSPACES_DIR = getHomePath("workspaces");

function ensureDir(dir: string): void {
    try {
        mkdirSync(dir, { recursive: true });
    } catch {
        // directory already exists
    }
}

export function loadRegistry(): WorkspacesRegistry {
    try {
        const raw = readFileSync(REGISTRY_PATH, "utf8");
        const json = JSON.parse(raw);
        const result = workspacesRegistrySchema.safeParse(json);

        if (result.success) {
            return result.data;
        }

        const patched = workspacesRegistrySchema.parse(json);
        saveRegistry(patched);
        return patched;
    } catch {
        ensureDir(dirname(REGISTRY_PATH));
        saveRegistry(DEFAULT_REGISTRY);
        return DEFAULT_REGISTRY;
    }
}

export function saveRegistry(registry: WorkspacesRegistry): void {
    ensureDir(dirname(REGISTRY_PATH));
    const json = JSON.stringify(registry, null, 4);
    writeFileSync(REGISTRY_PATH, json, "utf8");
}

export function listWorkspaces(): WorkspacesRegistry {
    return loadRegistry();
}

function deriveWorkspaceName(folderPath: string): string {
    const normalized = folderPath.replace(/\\/g, "/").replace(/\/+$/, "");
    const segments = normalized.split("/").filter(Boolean);

    if (segments.length >= 2) {
        return `${segments[segments.length - 2]}/${segments[segments.length - 1]}`;
    }

    return segments[segments.length - 1] ?? "Untitled";
}

export function addWorkspace(folderPath: string): Workspace {
    if (!existsSync(folderPath) || !statSync(folderPath).isDirectory()) {
        throw new Error(`Path does not exist or is not a directory: ${folderPath}`);
    }

    const registry = loadRegistry();

    const existing = registry.workspaces.find((w) => w.path === folderPath);
    if (existing) {
        registry.activeWorkspaceId = existing.id;
        existing.lastOpenedAt = new Date().toISOString();
        saveRegistry(registry);
        return existing;
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const name = deriveWorkspaceName(folderPath);

    const workspace: Workspace = {
        id,
        name,
        path: folderPath,
        createdAt: now,
        lastOpenedAt: now
    };

    ensureDir(join(WORKSPACES_DIR, id));

    registry.workspaces.push(workspace);
    registry.activeWorkspaceId = id;
    saveRegistry(registry);

    return workspace;
}

export function removeWorkspace(id: string): void {
    const registry = loadRegistry();
    const index = registry.workspaces.findIndex((w) => w.id === id);

    if (index === -1) {
        throw new Error(`Workspace not found: ${id}`);
    }

    registry.workspaces.splice(index, 1);

    if (registry.activeWorkspaceId === id) {
        registry.activeWorkspaceId = registry.workspaces[0]?.id ?? null;
    }

    saveRegistry(registry);
}

export function setActiveWorkspace(id: string): string {
    const registry = loadRegistry();
    const workspace = registry.workspaces.find((w) => w.id === id);

    if (!workspace) {
        throw new Error(`Workspace not found: ${id}`);
    }

    registry.activeWorkspaceId = id;
    workspace.lastOpenedAt = new Date().toISOString();
    saveRegistry(registry);

    return id;
}

export function getWorkspace(id: string): Workspace {
    const registry = loadRegistry();
    const workspace = registry.workspaces.find((w) => w.id === id);

    if (!workspace) {
        throw new Error(`Workspace not found: ${id}`);
    }

    return workspace;
}
