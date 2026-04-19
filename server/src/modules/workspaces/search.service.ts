import { readdir } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import type { Dirent } from "node:fs";
import { getWorkspace } from "./workspaces.service";

const HIDDEN_DIR_NAMES = new Set<string>([
    "node_modules",
    ".git",
    ".hg",
    ".svn",
    "dist",
    "build",
    "out",
    ".next",
    ".turbo",
    ".cache",
    ".parcel-cache",
    ".svelte-kit",
    "target",
    ".venv",
    "venv",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    "coverage",
    ".nyc_output"
]);

const MAX_TRAVERSED_ENTRIES = 5000;
const MAX_RESULTS = 30;

function toPosix(p: string): string {
    return sep === "\\" ? p.replace(/\\/g, "/") : p;
}

export type SearchEntryType = "file" | "directory";

export interface SearchEntry {
    name: string;
    path: string;
    type: SearchEntryType;
}

export interface WorkspaceSearchResult {
    workspaceId: string;
    workspacePath: string;
    query: string;
    results: SearchEntry[];
}

interface Candidate extends SearchEntry {
    score: number;
}

function scoreEntry(
    name: string,
    path: string,
    type: SearchEntryType,
    lowerQuery: string
): number | null {
    if (lowerQuery.length === 0) {
        return 0;
    }

    const lowerName = name.toLowerCase();
    const lowerPath = path.toLowerCase();

    if (lowerName === lowerQuery) {
        return 10_000 - path.length;
    }

    if (lowerName.startsWith(lowerQuery)) {
        return 5_000 - path.length + (type === "directory" ? 100 : 0);
    }

    const nameIdx = lowerName.indexOf(lowerQuery);
    if (nameIdx >= 0) {
        return 2_500 - nameIdx * 10 - path.length;
    }

    const pathIdx = lowerPath.indexOf(lowerQuery);
    if (pathIdx >= 0) {
        return 1_000 - pathIdx - path.length;
    }

    return null;
}

export async function searchWorkspace(
    workspaceId: string,
    rawQuery: string
): Promise<WorkspaceSearchResult> {
    const workspace = getWorkspace(workspaceId);
    const root = resolve(workspace.path);
    const query = rawQuery.trim();
    const lowerQuery = query.toLowerCase();

    const candidates: Candidate[] = [];
    let traversed = 0;

    const queue: string[] = [root];

    while (queue.length > 0 && traversed < MAX_TRAVERSED_ENTRIES) {
        const current = queue.shift()!;
        let dirents: Dirent[];
        try {
            dirents = (await readdir(current, {
                withFileTypes: true
            })) as Dirent[];
        } catch {
            continue;
        }

        for (const d of dirents) {
            if (traversed >= MAX_TRAVERSED_ENTRIES) break;
            traversed += 1;

            if (d.isSymbolicLink()) continue;
            const isDir = d.isDirectory();
            if (!isDir && !d.isFile()) continue;
            if (isDir && HIDDEN_DIR_NAMES.has(d.name)) continue;

            const abs = join(current, d.name);
            const rel = toPosix(relative(root, abs));
            const type: SearchEntryType = isDir ? "directory" : "file";

            const score = scoreEntry(d.name, rel, type, lowerQuery);
            if (score !== null) {
                candidates.push({
                    name: d.name,
                    path: rel,
                    type,
                    score
                });
            }

            if (isDir) {
                queue.push(abs);
            }
        }
    }

    candidates.sort((a, b) => {
        if (a.score !== b.score) return b.score - a.score;
        if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
        return a.path.localeCompare(b.path);
    });

    const results = candidates.slice(0, MAX_RESULTS).map((c) => ({
        name: c.name,
        path: c.path,
        type: c.type
    }));

    return {
        workspaceId,
        workspacePath: toPosix(root),
        query,
        results
    };
}
