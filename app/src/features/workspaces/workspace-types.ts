export interface Workspace {
    id: string;
    name: string;
    path: string;
    createdAt: string;
    lastOpenedAt: string;
}

export interface WorkspacesData {
    activeWorkspaceId: string | null;
    workspaces: Workspace[];
}

// Mirror of the server-side reserved id for the always-present "Home"
// workspace (see `server/src/modules/workspaces/workspaces.types.ts`).
// Used by the sidebar to pin Home to the top, hide its drag handle, and
// hide the "Close workspace" context-menu item.
export const HOME_WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";
