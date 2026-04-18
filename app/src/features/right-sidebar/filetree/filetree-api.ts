import { api } from "@/lib/api";
import type {
    FiletreeDirectoryListing,
    WorkspaceFileContent
} from "./filetree-types";

export function fetchDirectory(workspaceId: string, path: string = "") {
    return api.get<FiletreeDirectoryListing>(
        `/workspaces/${workspaceId}/tree`,
        { query: { path } }
    );
}

export function fetchFile(workspaceId: string, path: string) {
    return api.get<WorkspaceFileContent>(
        `/workspaces/${workspaceId}/file`,
        { query: { path } }
    );
}
