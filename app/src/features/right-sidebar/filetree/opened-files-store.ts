import { create } from "zustand";
import { toApiErrorMessage } from "@/lib/api";
import { fetchFile } from "./filetree-api";

export type SystemTabId = "git" | "browser" | "terminal" | "filetree";

export type ActiveView =
    | { kind: "system"; id: SystemTabId }
    | { kind: "file"; path: string };

export interface OpenedFile {
    path: string;
    name: string;
    size: number;
    content: string | null;
    truncated: boolean;
    binary: boolean;
    loading: boolean;
    error: string | null;
}

interface OpenedFilesState {
    workspaceId: string | null;
    active: ActiveView;
    order: string[];
    files: Record<string, OpenedFile>;

    setWorkspace: (id: string | null) => void;
    setActive: (view: ActiveView) => void;
    openFile: (path: string, name: string) => void;
    openVirtualFile: (path: string, name: string) => void;
    closeFile: (path: string) => void;
    refreshFile: (path: string) => Promise<void>;
}

const DEFAULT_ACTIVE: ActiveView = { kind: "system", id: "git" };

export const useOpenedFilesStore = create<OpenedFilesState>()((set, get) => ({
    workspaceId: null,
    active: DEFAULT_ACTIVE,
    order: [],
    files: {},

    setWorkspace: (id) => {
        if (id === get().workspaceId) return;
        const currentActive = get().active;
        const nextActive: ActiveView =
            currentActive.kind === "system" ? currentActive : DEFAULT_ACTIVE;
        set({
            workspaceId: id,
            active: nextActive,
            order: [],
            files: {}
        });
    },

    setActive: (view) => set({ active: view }),

    openFile: (path, name) => {
        const existing = get().files[path];

        if (!existing) {
            set((state) => ({
                order: [...state.order, path],
                files: {
                    ...state.files,
                    [path]: {
                        path,
                        name,
                        size: 0,
                        content: null,
                        truncated: false,
                        binary: false,
                        loading: true,
                        error: null
                    }
                },
                active: { kind: "file", path }
            }));
            void get().refreshFile(path);
            return;
        }

        set({ active: { kind: "file", path } });

        if (
            !existing.loading &&
            existing.content === null &&
            !existing.error
        ) {
            void get().refreshFile(path);
        }
    },

    openVirtualFile: (path, name) => {
        const existing = get().files[path];
        if (existing) {
            set((state) => ({
                files: {
                    ...state.files,
                    [path]: { ...existing, name }
                },
                active: { kind: "file", path }
            }));
            return;
        }
        set((state) => ({
            order: [...state.order, path],
            files: {
                ...state.files,
                [path]: {
                    path,
                    name,
                    size: 0,
                    content: "",
                    truncated: false,
                    binary: false,
                    loading: false,
                    error: null
                }
            },
            active: { kind: "file", path }
        }));
    },

    closeFile: (path) => {
        const { order } = get();
        const idx = order.indexOf(path);
        if (idx === -1) return;

        const nextOrder = order.filter((p) => p !== path);

        set((state) => {
            const nextFiles = { ...state.files };
            delete nextFiles[path];

            let nextActive = state.active;
            if (state.active.kind === "file" && state.active.path === path) {
                if (nextOrder.length === 0) {
                    nextActive = { kind: "system", id: "filetree" };
                } else {
                    const neighborIdx = Math.min(idx, nextOrder.length - 1);
                    nextActive = {
                        kind: "file",
                        path: nextOrder[neighborIdx]
                    };
                }
            }

            return {
                order: nextOrder,
                files: nextFiles,
                active: nextActive
            };
        });
    },

    refreshFile: async (path) => {
        const workspaceId = get().workspaceId;
        if (!workspaceId) return;

        set((state) => {
            const current = state.files[path];
            if (!current) return {};
            return {
                files: {
                    ...state.files,
                    [path]: { ...current, loading: true, error: null }
                }
            };
        });

        try {
            const res = await fetchFile(workspaceId, path);
            if (get().workspaceId !== workspaceId || !get().files[path]) return;
            set((state) => {
                const current = state.files[path];
                if (!current) return {};
                return {
                    files: {
                        ...state.files,
                        [path]: {
                            ...current,
                            content: res.binary ? "" : res.content,
                            size: res.size,
                            truncated: res.truncated,
                            binary: res.binary,
                            loading: false,
                            error: null
                        }
                    }
                };
            });
        } catch (error) {
            if (get().workspaceId !== workspaceId || !get().files[path]) return;
            const message = toApiErrorMessage(error, "Failed to load file");
            set((state) => {
                const current = state.files[path];
                if (!current) return {};
                return {
                    files: {
                        ...state.files,
                        [path]: {
                            ...current,
                            loading: false,
                            error: message
                        }
                    }
                };
            });
        }
    }
}));
