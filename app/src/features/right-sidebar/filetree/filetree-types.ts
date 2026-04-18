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
