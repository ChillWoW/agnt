import { api } from "@/lib/api";
import type {
    GitCommitResult,
    GitFileDiff,
    GitStatus
} from "./git-types";

export function fetchGitStatus(workspaceId: string) {
    return api.get<GitStatus>(`/workspaces/${workspaceId}/git/status`);
}

export function fetchGitDiff(
    workspaceId: string,
    path: string,
    side: "staged" | "unstaged" | "combined" = "combined",
    oldPath?: string
) {
    return api.get<GitFileDiff>(`/workspaces/${workspaceId}/git/diff`, {
        query: oldPath ? { path, side, oldPath } : { path, side }
    });
}

export function stageGitPath(workspaceId: string, path: string) {
    return api.post<{ ok: true }>(`/workspaces/${workspaceId}/git/stage`, {
        body: { path }
    });
}

export function unstageGitPath(workspaceId: string, path: string) {
    return api.post<{ ok: true }>(`/workspaces/${workspaceId}/git/unstage`, {
        body: { path }
    });
}

export function stageAllGit(workspaceId: string) {
    return api.post<{ ok: true }>(
        `/workspaces/${workspaceId}/git/stage-all`,
        {}
    );
}

export function unstageAllGit(workspaceId: string) {
    return api.post<{ ok: true }>(
        `/workspaces/${workspaceId}/git/unstage-all`,
        {}
    );
}

export function discardGitPath(workspaceId: string, path: string) {
    return api.post<{ ok: true }>(`/workspaces/${workspaceId}/git/discard`, {
        body: { path }
    });
}

export function commitGit(
    workspaceId: string,
    message: string,
    options: { allowEmpty?: boolean; signoff?: boolean } = {}
) {
    return api.post<GitCommitResult>(`/workspaces/${workspaceId}/git/commit`, {
        body: { message, ...options }
    });
}
