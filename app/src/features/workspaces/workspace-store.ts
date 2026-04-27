import { create } from "zustand";
import type { Workspace } from "./workspace-types";
import * as workspaceApi from "./workspace-api";
// Import directly from the store module rather than the package index to
// avoid a circular module load: workspaces/index → workspace-store →
// split-panes/index → pane-scope → workspaces/index.
import { useSplitPaneStore } from "@/features/split-panes/split-pane-store";

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
        // Drop any open split panes that belonged to the removed workspace
        // so we don't carry orphan panes pointing at a workspace that's no
        // longer reachable. (Other workspaces' panes are unaffected since
        // the layout is global.)
        useSplitPaneStore.getState().forgetWorkspace(id);
        await get().load();
    },

    setActive: async (id: string) => {
        // Optimistically flip the local active workspace before the
        // server round-trip completes. Callers (sidebar click → route
        // navigation, home workspace picker, etc.) typically navigate
        // synchronously right after firing this off, and the route they
        // land on reads `activeWorkspaceId` to load the conversation
        // out of the right per-workspace SQLite DB. Without this
        // optimistic update, a cross-workspace click would race the
        // pending API call and trigger a "Conversation not found" fetch
        // against the previous workspace's DB.
        if (get().activeWorkspaceId !== id) {
            set({ activeWorkspaceId: id });
        }
        const result = await workspaceApi.setActiveWorkspace(id);
        if (get().activeWorkspaceId !== result.activeWorkspaceId) {
            set({ activeWorkspaceId: result.activeWorkspaceId });
        }
    }
}));

export function getActiveWorkspace(): Workspace | undefined {
    const { workspaces, activeWorkspaceId } = useWorkspaceStore.getState();
    return workspaces.find((w) => w.id === activeWorkspaceId);
}
