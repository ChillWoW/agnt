import { z } from "zod";

// Reserved id for the always-present "Home" workspace, which points at the
// OS user home directory. Stable across machines so per-workspace SQLite,
// state, and history all key off the same id. Format is a valid UUIDv4 so
// it passes the existing `z.string().uuid()` constraint without us having
// to relax the schema.
export const HOME_WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";
export const HOME_WORKSPACE_NAME = "Home";

export const workspaceSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    path: z.string(),
    createdAt: z.string().datetime(),
    lastOpenedAt: z.string().datetime()
});

export const workspacesRegistrySchema = z.object({
    activeWorkspaceId: z.string().uuid().nullable().default(null),
    workspaces: z.array(workspaceSchema).default([])
});

export type Workspace = z.infer<typeof workspaceSchema>;
export type WorkspacesRegistry = z.infer<typeof workspacesRegistrySchema>;

export const DEFAULT_REGISTRY: WorkspacesRegistry =
    workspacesRegistrySchema.parse({});
