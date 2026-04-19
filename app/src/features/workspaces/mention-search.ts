import { api } from "@/lib/api";

export type MentionEntryType = "file" | "directory";

export interface MentionEntry {
    name: string;
    path: string;
    type: MentionEntryType;
}

interface TreeResponse {
    workspaceId: string;
    workspacePath: string;
    path: string;
    entries: Array<{
        name: string;
        path: string;
        type: MentionEntryType;
    }>;
}

interface SearchResponse {
    workspaceId: string;
    workspacePath: string;
    query: string;
    results: Array<{
        name: string;
        path: string;
        type: MentionEntryType;
    }>;
}

export async function fetchWorkspaceTree(
    workspaceId: string,
    path: string,
    signal?: AbortSignal
): Promise<MentionEntry[]> {
    const data = await api.get<TreeResponse>(
        `/workspaces/${workspaceId}/tree`,
        { query: { path }, signal }
    );
    return data.entries.map((entry) => ({
        name: entry.name,
        path: entry.path,
        type: entry.type
    }));
}

export async function fetchWorkspaceSearch(
    workspaceId: string,
    query: string,
    signal?: AbortSignal
): Promise<MentionEntry[]> {
    const data = await api.get<SearchResponse>(
        `/workspaces/${workspaceId}/search`,
        { query: { q: query }, signal }
    );
    return data.results.map((entry) => ({
        name: entry.name,
        path: entry.path,
        type: entry.type
    }));
}
