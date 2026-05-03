import { create } from "zustand";
import { toApiErrorMessage } from "@/lib/api";
import { toast } from "@/components/ui";
import {
    commitGit,
    discardGitPath,
    fetchGitDiff,
    fetchGitStatus,
    stageAllGit,
    stageGitPath,
    unstageAllGit,
    unstageGitPath
} from "./git-api";
import type {
    GitFileChange,
    GitFileDiff,
    GitStatus
} from "./git-types";

/**
 * A row identity within the Git tab. The tab can render the same path twice
 * (once on the staged side, once unstaged) so we always pair `path` with
 * `side` to disambiguate selection and per-row busy state.
 */
export type GitRowKey = string; // `${side}::${path}`

export function rowKey(change: GitFileChange): GitRowKey {
    return `${change.side}::${change.path}`;
}

interface DiffEntry {
    diff: GitFileDiff | null;
    loading: boolean;
    error: string | null;
}

interface GitStoreState {
    workspaceId: string | null;

    status: GitStatus | null;
    statusLoading: boolean;
    statusError: string | null;

    /** Selected row in the changes list, or null when none is open. */
    selected: { path: string; side: "staged" | "unstaged" } | null;
    /** Diff cache keyed by `${side}::${path}` so a re-click is instant. */
    diffs: Record<GitRowKey, DiffEntry>;

    /** Per-row spinners for stage/unstage/discard actions. */
    busyKeys: Record<GitRowKey, boolean>;
    /** Non-row-scoped action spinners (commit, stage-all, unstage-all). */
    pendingAction: "commit" | "stage-all" | "unstage-all" | null;

    commitMessage: string;
    setCommitMessage: (next: string) => void;

    setWorkspace: (id: string | null) => void;
    refresh: () => Promise<void>;
    select: (
        change: { path: string; side: "staged" | "unstaged" } | null
    ) => void;
    loadDiff: (change: GitFileChange) => Promise<void>;
    stage: (change: GitFileChange) => Promise<void>;
    unstage: (change: GitFileChange) => Promise<void>;
    discard: (change: GitFileChange) => Promise<void>;
    stageAll: () => Promise<void>;
    unstageAll: () => Promise<void>;
    commit: () => Promise<void>;
}

const EMPTY_DIFF_ENTRY: DiffEntry = {
    diff: null,
    loading: false,
    error: null
};

export const useGitStore = create<GitStoreState>()((set, get) => ({
    workspaceId: null,

    status: null,
    statusLoading: false,
    statusError: null,

    selected: null,
    diffs: {},
    busyKeys: {},
    pendingAction: null,

    commitMessage: "",
    setCommitMessage: (next) => set({ commitMessage: next }),

    setWorkspace: (id) => {
        if (id === get().workspaceId) return;
        set({
            workspaceId: id,
            status: null,
            statusError: null,
            selected: null,
            diffs: {},
            busyKeys: {},
            pendingAction: null,
            commitMessage: ""
        });
        if (id) void get().refresh();
    },

    refresh: async () => {
        const workspaceId = get().workspaceId;
        if (!workspaceId) return;
        set({ statusLoading: true, statusError: null });
        try {
            const status = await fetchGitStatus(workspaceId);
            if (get().workspaceId !== workspaceId) return;
            const sel = get().selected;
            const allChanges = [
                ...status.staged,
                ...status.unstaged,
                ...status.untracked,
                ...status.conflicted
            ];
            // If the row the user had open is gone (e.g. they staged it,
            // moving it from `unstaged` → `staged`), keep the selection on
            // the same FILE if it still exists under a different side.
            // Otherwise drop the selection entirely.
            let nextSelected: GitStoreState["selected"] = null;
            let resolvedChange: GitFileChange | undefined;
            if (sel) {
                resolvedChange = allChanges.find(
                    (c) => c.path === sel.path && c.side === sel.side
                );
                if (resolvedChange) {
                    nextSelected = sel;
                } else {
                    const migrated = allChanges.find(
                        (c) => c.path === sel.path
                    );
                    if (migrated) {
                        nextSelected = {
                            path: migrated.path,
                            side: migrated.side
                        };
                        resolvedChange = migrated;
                    }
                }
            }
            set({
                status,
                statusLoading: false,
                selected: nextSelected
            });
            // Hot-refresh the open diff so it reflects what's on disk now.
            if (resolvedChange) void get().loadDiff(resolvedChange);
        } catch (error) {
            if (get().workspaceId !== workspaceId) return;
            set({
                statusLoading: false,
                statusError: toApiErrorMessage(
                    error,
                    "Failed to read git status"
                )
            });
        }
    },

    select: (next) => {
        set({ selected: next });
    },

    loadDiff: async (change) => {
        const workspaceId = get().workspaceId;
        if (!workspaceId) return;
        const key = rowKey(change);

        set((state) => ({
            diffs: {
                ...state.diffs,
                [key]: {
                    diff: state.diffs[key]?.diff ?? null,
                    loading: true,
                    error: null
                }
            }
        }));

        try {
            const diff = await fetchGitDiff(
                workspaceId,
                change.path,
                change.side,
                change.oldPath
            );
            if (get().workspaceId !== workspaceId) return;
            set((state) => ({
                diffs: {
                    ...state.diffs,
                    [key]: { diff, loading: false, error: null }
                }
            }));
        } catch (error) {
            if (get().workspaceId !== workspaceId) return;
            set((state) => ({
                diffs: {
                    ...state.diffs,
                    [key]: {
                        diff: state.diffs[key]?.diff ?? null,
                        loading: false,
                        error: toApiErrorMessage(error, "Failed to load diff")
                    }
                }
            }));
        }
    },

    stage: async (change) => {
        const workspaceId = get().workspaceId;
        if (!workspaceId) return;
        const key = rowKey(change);
        set((state) => ({
            busyKeys: { ...state.busyKeys, [key]: true }
        }));
        try {
            await stageGitPath(workspaceId, change.path);
            await get().refresh();
        } catch (error) {
            toast.error({
                title: "Couldn't stage file",
                description: toApiErrorMessage(error, "Failed to stage file")
            });
        } finally {
            set((state) => {
                const next = { ...state.busyKeys };
                delete next[key];
                return { busyKeys: next };
            });
        }
    },

    unstage: async (change) => {
        const workspaceId = get().workspaceId;
        if (!workspaceId) return;
        const key = rowKey(change);
        set((state) => ({
            busyKeys: { ...state.busyKeys, [key]: true }
        }));
        try {
            await unstageGitPath(workspaceId, change.path);
            await get().refresh();
        } catch (error) {
            toast.error({
                title: "Couldn't unstage file",
                description: toApiErrorMessage(error, "Failed to unstage file")
            });
        } finally {
            set((state) => {
                const next = { ...state.busyKeys };
                delete next[key];
                return { busyKeys: next };
            });
        }
    },

    discard: async (change) => {
        const workspaceId = get().workspaceId;
        if (!workspaceId) return;
        const key = rowKey(change);
        set((state) => ({
            busyKeys: { ...state.busyKeys, [key]: true }
        }));
        try {
            await discardGitPath(workspaceId, change.path);
            await get().refresh();
            toast.success({
                title: "Discarded changes",
                description: change.path
            });
        } catch (error) {
            toast.error({
                title: "Couldn't discard changes",
                description: toApiErrorMessage(
                    error,
                    "Failed to discard changes"
                )
            });
        } finally {
            set((state) => {
                const next = { ...state.busyKeys };
                delete next[key];
                return { busyKeys: next };
            });
        }
    },

    stageAll: async () => {
        const workspaceId = get().workspaceId;
        if (!workspaceId) return;
        set({ pendingAction: "stage-all" });
        try {
            await stageAllGit(workspaceId);
            await get().refresh();
        } catch (error) {
            toast.error({
                title: "Couldn't stage all",
                description: toApiErrorMessage(error, "Failed to stage all")
            });
        } finally {
            set({ pendingAction: null });
        }
    },

    unstageAll: async () => {
        const workspaceId = get().workspaceId;
        if (!workspaceId) return;
        set({ pendingAction: "unstage-all" });
        try {
            await unstageAllGit(workspaceId);
            await get().refresh();
        } catch (error) {
            toast.error({
                title: "Couldn't unstage all",
                description: toApiErrorMessage(error, "Failed to unstage all")
            });
        } finally {
            set({ pendingAction: null });
        }
    },

    commit: async () => {
        const workspaceId = get().workspaceId;
        if (!workspaceId) return;
        const message = get().commitMessage.trim();
        if (!message) return;
        set({ pendingAction: "commit" });
        try {
            const result = await commitGit(workspaceId, message);
            set({ commitMessage: "" });
            await get().refresh();
            toast.success({
                title: result.sha
                    ? `Committed ${result.sha}`
                    : "Committed",
                description: result.summary
            });
        } catch (error) {
            toast.error({
                title: "Commit failed",
                description: toApiErrorMessage(error, "Failed to commit")
            });
        } finally {
            set({ pendingAction: null });
        }
    }
}));

/**
 * Convenience: returns the currently-selected change row, or null. Resolved
 * by walking the latest `status` so it stays consistent with the diff cache
 * (which is keyed by `path` + `side`).
 */
export function selectSelectedChange(state: {
    status: GitStatus | null;
    selected: GitStoreState["selected"];
}): GitFileChange | null {
    if (!state.status || !state.selected) return null;
    const { path, side } = state.selected;
    const all = [
        ...state.status.staged,
        ...state.status.unstaged,
        ...state.status.untracked,
        ...state.status.conflicted
    ];
    return all.find((c) => c.path === path && c.side === side) ?? null;
}

export { EMPTY_DIFF_ENTRY };
