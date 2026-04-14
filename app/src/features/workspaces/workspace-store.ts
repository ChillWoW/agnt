import { create } from "zustand";
import type { Workspace } from "./workspace-types";
import * as workspaceApi from "./workspace-api";

interface WorkspaceStoreState {
    workspaces: Workspace[];
    activeWorkspaceId: string | null;
    isLoading: boolean;

    load: () => Promise<void>;
    add: (path: string) => Promise<void>;
    remove: (id: string) => Promise<void>;
    setActive: (id: string) => Promise<void>;
}

export const useWorkspaceStore = create<WorkspaceStoreState>()((set, get) => ({
    workspaces: [],
    activeWorkspaceId: null,
    isLoading: false,

    load: async () => {
        set({ isLoading: true });
        try {
            const data = await workspaceApi.fetchWorkspaces();
            set({
                workspaces: data.workspaces,
                activeWorkspaceId: data.activeWorkspaceId
            });
        } finally {
            set({ isLoading: false });
        }
    },

    add: async (path: string) => {
        const workspace = await workspaceApi.addWorkspace(path);
        const { workspaces } = get();
        const exists = workspaces.some((w) => w.id === workspace.id);

        set({
            workspaces: exists ? workspaces : [...workspaces, workspace],
            activeWorkspaceId: workspace.id
        });
    },

    remove: async (id: string) => {
        await workspaceApi.removeWorkspace(id);
        await get().load();
    },

    setActive: async (id: string) => {
        const result = await workspaceApi.setActiveWorkspace(id);
        set({ activeWorkspaceId: result.activeWorkspaceId });
    }
}));

export function getActiveWorkspace(): Workspace | undefined {
    const { workspaces, activeWorkspaceId } = useWorkspaceStore.getState();
    return workspaces.find((w) => w.id === activeWorkspaceId);
}
