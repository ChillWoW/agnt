export type GitChangeKind =
    | "modified"
    | "added"
    | "deleted"
    | "renamed"
    | "copied"
    | "type-changed"
    | "untracked"
    | "conflicted";

export interface GitFileChange {
    path: string;
    oldPath?: string;
    side: "staged" | "unstaged";
    kind: GitChangeKind;
    conflicted: boolean;
    additions: number | null;
    deletions: number | null;
    binary: boolean;
}

export interface GitBranchInfo {
    branch: string | null;
    detachedHead?: string;
    upstream: string | null;
    ahead: number;
    behind: number;
}

export interface GitStatus {
    workspaceId: string;
    isRepo: boolean;
    branch: GitBranchInfo;
    staged: GitFileChange[];
    unstaged: GitFileChange[];
    untracked: GitFileChange[];
    conflicted: GitFileChange[];
}

export interface GitFileDiff {
    workspaceId: string;
    path: string;
    oldPath?: string;
    side: "staged" | "unstaged" | "combined";
    binary: boolean;
    oldContents: string;
    newContents: string;
}

export interface GitCommitResult {
    workspaceId: string;
    sha: string;
    branch: string | null;
    summary: string;
}
