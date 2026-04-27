export interface Workspace {
    id: string;
    name: string;
    path: string;
    createdAt: string;
    lastOpenedAt: string;
}

export interface WorkspacesData {
    activeWorkspaceId: string | null;
    workspaces: Workspace[];
}
