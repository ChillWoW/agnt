export type FiletreeEntryType = "directory" | "file";

export interface FiletreeEntry {
    name: string;
    path: string;
    type: FiletreeEntryType;
    size?: number;
    mtimeMs: number;
}

export interface FiletreeDirectoryListing {
    workspaceId: string;
    workspacePath: string;
    path: string;
    entries: FiletreeEntry[];
}

export interface WorkspaceFileContent {
    workspaceId: string;
    path: string;
    size: number;
    bytesRead: number;
    truncated: boolean;
    binary: boolean;
    content: string;
    mtimeMs: number;
}
