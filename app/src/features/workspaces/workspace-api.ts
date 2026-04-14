import { api } from "@/lib/api";
import type { Workspace, WorkspacesData } from "./workspace-types";

export function fetchWorkspaces() {
    return api.get<WorkspacesData>("/workspaces");
}

export function addWorkspace(path: string) {
    return api.post<Workspace>("/workspaces", { body: { path } });
}

export function removeWorkspace(id: string) {
    return api.delete<{ success: boolean }>(`/workspaces/${id}`);
}

export function setActiveWorkspace(id: string) {
    return api.patch<{ activeWorkspaceId: string }>("/workspaces/active", {
        body: { id }
    });
}
