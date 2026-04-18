import { api } from "@/lib/api";
import type { FiletreeDirectoryListing } from "./filetree-types";

export function fetchDirectory(workspaceId: string, path: string = "") {
    return api.get<FiletreeDirectoryListing>(
        `/workspaces/${workspaceId}/tree`,
        { query: { path } }
    );
}
