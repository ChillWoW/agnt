import { z } from "zod";

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
