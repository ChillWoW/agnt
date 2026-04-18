import { create } from "zustand";
import { toApiErrorMessage } from "@/lib/api";
import { fetchDirectory } from "./filetree-api";
import type { FiletreeEntry } from "./filetree-types";

interface DirectoryState {
    entries: FiletreeEntry[] | null;
    loading: boolean;
    error: string | null;
}

interface FiletreeStoreState {
    workspaceId: string | null;
    directories: Record<string, DirectoryState>;
    expanded: Record<string, boolean>;

    setWorkspace: (id: string | null) => void;
    loadDirectory: (path: string) => Promise<void>;
    toggle: (path: string) => void;
    refreshAll: () => Promise<void>;
}

const ROOT_PATH = "";

export const useFiletreeStore = create<FiletreeStoreState>()((set, get) => ({
    workspaceId: null,
    directories: {},
    expanded: {},

    setWorkspace: (id) => {
        if (id === get().workspaceId) return;
        set({ workspaceId: id, directories: {}, expanded: {} });
        if (id) void get().loadDirectory(ROOT_PATH);
    },

    loadDirectory: async (path) => {
        const workspaceId = get().workspaceId;
        if (!workspaceId) return;

        set((state) => ({
            directories: {
                ...state.directories,
                [path]: {
                    entries: state.directories[path]?.entries ?? null,
                    loading: true,
                    error: null
                }
            }
        }));

        try {
            const res = await fetchDirectory(workspaceId, path);
            if (get().workspaceId !== workspaceId) return;
            set((state) => ({
                directories: {
                    ...state.directories,
                    [path]: {
                        entries: res.entries,
                        loading: false,
                        error: null
                    }
                }
            }));
        } catch (error) {
            if (get().workspaceId !== workspaceId) return;
            const message = toApiErrorMessage(error, "Failed to load directory");
            set((state) => ({
                directories: {
                    ...state.directories,
                    [path]: {
                        entries: state.directories[path]?.entries ?? null,
                        loading: false,
                        error: message
                    }
                }
            }));
        }
    },

    toggle: (path) => {
        const isExpanded = !!get().expanded[path];
        const nextExpanded = !isExpanded;

        set((state) => {
            const next = { ...state.expanded };
            if (nextExpanded) next[path] = true;
            else delete next[path];
            return { expanded: next };
        });

        if (nextExpanded && !get().directories[path]?.entries) {
            void get().loadDirectory(path);
        }
    },

    refreshAll: async () => {
        const { directories, expanded, workspaceId } = get();
        if (!workspaceId) return;

        const paths = new Set<string>([ROOT_PATH, ...Object.keys(expanded)]);
        const jobs: Promise<void>[] = [];

        for (const p of paths) {
            if (p !== ROOT_PATH && !directories[p]) continue;
            jobs.push(get().loadDirectory(p));
        }

        await Promise.all(jobs);
    }
}));
