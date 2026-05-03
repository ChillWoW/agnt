/**
 * Workspace-relative git state surfaced to the right-sidebar Git tab.
 *
 * The server wraps `git` (we shell out via `Bun.spawn`) and normalizes the
 * porcelain output into a UI-friendly shape so the frontend doesn't have to
 * understand the two-character XY status codes itself.
 */

export type GitChangeKind =
    | "modified"
    | "added"
    | "deleted"
    | "renamed"
    | "copied"
    | "type-changed"
    | "untracked"
    | "conflicted";

/**
 * A single file row in the Git tab. We split a porcelain entry into two
 * `GitFileChange` rows when both index (staged) and worktree (unstaged) sides
 * carry changes — that way the UI can display them in their respective
 * sections and offer the matching stage/unstage action per row.
 */
export interface GitFileChange {
    /** Workspace-relative POSIX path (single slashes). */
    path: string;
    /** For renames/copies: the previous path (workspace-relative POSIX). */
    oldPath?: string;
    /** Which side of the porcelain entry this row represents. */
    side: "staged" | "unstaged";
    /** Coarse change category for icon + label rendering. */
    kind: GitChangeKind;
    /** True when the file has any merge-conflict marker (XY contains U). */
    conflicted: boolean;
    /**
     * Bytes added / removed for the diff this row represents (staged or
     * unstaged side). `null` when we couldn't compute it (e.g. binary).
     */
    additions: number | null;
    deletions: number | null;
    /** True when `git` reported this side as binary. */
    binary: boolean;
}

export interface GitBranchInfo {
    /** Current branch name, or null when detached. */
    branch: string | null;
    /** When detached, the short SHA we're sitting on. */
    detachedHead?: string;
    /** Configured upstream branch (e.g. `origin/main`), if any. */
    upstream: string | null;
    /** Commits ahead of upstream. 0 when no upstream. */
    ahead: number;
    /** Commits behind upstream. 0 when no upstream. */
    behind: number;
}

export interface GitStatus {
    workspaceId: string;
    /** True when this workspace is a git repository. */
    isRepo: boolean;
    branch: GitBranchInfo;
    /** Files staged for the next commit. */
    staged: GitFileChange[];
    /** Tracked files with worktree changes. */
    unstaged: GitFileChange[];
    /** New, never-tracked files. */
    untracked: GitFileChange[];
    /** Files with unresolved merge conflicts. */
    conflicted: GitFileChange[];
}

export interface GitFileDiff {
    workspaceId: string;
    path: string;
    /** Workspace-relative POSIX path of the previous name, if renamed. */
    oldPath?: string;
    /** Which side of the diff was requested. */
    side: "staged" | "unstaged" | "combined";
    /** True when either the old or new revision is binary. */
    binary: boolean;
    /** Full content of the "old" revision (HEAD-side or index-side). */
    oldContents: string;
    /** Full content of the "new" revision (index-side or worktree-side). */
    newContents: string;
}

export interface GitCommitResult {
    workspaceId: string;
    /** SHA of the new commit (short form). */
    sha: string;
    branch: string | null;
    summary: string;
}
