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

// Module-level caches so the popup can render instantly while a fresh fetch
// happens in the background. Keyed by workspace + path / query so different
// workspaces don't collide. Entries live for the lifetime of the page;
// every successful fetch overwrites the cached value, so stale data never
// sticks around.
const treeCache = new Map<string, MentionEntry[]>();
const searchCache = new Map<string, MentionEntry[]>();

// Tracks in-flight requests so we never start two identical fetches at once
// (e.g. when the editor remounts a popup that we've also prefetched on
// startup, or when the user spams @-then-escape).
const treeInflight = new Map<string, Promise<MentionEntry[]>>();
const searchInflight = new Map<string, Promise<MentionEntry[]>>();

function treeKey(workspaceId: string, path: string): string {
    return `${workspaceId}::${path}`;
}

function searchKey(workspaceId: string, query: string): string {
    return `${workspaceId}::${query.toLowerCase()}`;
}

export function readCachedTree(
    workspaceId: string,
    path: string
): MentionEntry[] | undefined {
    return treeCache.get(treeKey(workspaceId, path));
}

export function readCachedSearch(
    workspaceId: string,
    query: string
): MentionEntry[] | undefined {
    return searchCache.get(searchKey(workspaceId, query));
}

export async function fetchWorkspaceTree(
    workspaceId: string,
    path: string,
    signal?: AbortSignal
): Promise<MentionEntry[]> {
    const key = treeKey(workspaceId, path);
    const existing = treeInflight.get(key);
    if (existing) return existing;

    const promise = (async () => {
        const data = await api.get<TreeResponse>(
            `/workspaces/${workspaceId}/tree`,
            { query: { path }, signal }
        );
        const entries: MentionEntry[] = data.entries.map((entry) => ({
            name: entry.name,
            path: entry.path,
            type: entry.type
        }));
        treeCache.set(key, entries);
        return entries;
    })().finally(() => {
        treeInflight.delete(key);
    });

    treeInflight.set(key, promise);
    return promise;
}

export async function fetchWorkspaceSearch(
    workspaceId: string,
    query: string,
    signal?: AbortSignal
): Promise<MentionEntry[]> {
    const key = searchKey(workspaceId, query);
    const existing = searchInflight.get(key);
    if (existing) return existing;

    const promise = (async () => {
        const data = await api.get<SearchResponse>(
            `/workspaces/${workspaceId}/search`,
            { query: { q: query }, signal }
        );
        const entries: MentionEntry[] = data.results.map((entry) => ({
            name: entry.name,
            path: entry.path,
            type: entry.type
        }));
        searchCache.set(key, entries);
        return entries;
    })().finally(() => {
        searchInflight.delete(key);
    });

    searchInflight.set(key, promise);
    return promise;
}

/**
 * Fire-and-forget prefetch for the root tree of a workspace so the first @
 * the user types is instant. Safe to call repeatedly — duplicate calls are
 * deduped via the in-flight map and the cache is checked first.
 */
export function prefetchWorkspaceTree(
    workspaceId: string,
    path: string = ""
): void {
    if (treeCache.has(treeKey(workspaceId, path))) return;
    fetchWorkspaceTree(workspaceId, path).catch(() => {
        // Swallow — prefetch failures are not user-visible; the real fetch
        // triggered when the popup opens will surface the error if it
        // persists.
    });
}
