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

export interface RepoInstructionSource {
    path: string;
    relativePath: string;
    fileName: string;
    priority: number;
    bytes: number;
    charCount: number;
    truncated: boolean;
    content: string;
}

export interface WorkspaceRepoInstructions {
    workspaceId: string;
    workspacePath: string;
    sources: RepoInstructionSource[];
    mergedContent: string;
    truncated: boolean;
    warnings: string[];
}
