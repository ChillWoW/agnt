import { readdir, stat } from "node:fs/promises";
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

function toPosix(p: string): string {
    return sep === "\\" ? p.replace(/\\/g, "/") : p;
}

function isInside(parent: string, child: string): boolean {
    const rel = relative(parent, child);
    if (rel === "") return true;
    if (rel.startsWith("..")) return false;
    if (/^[a-zA-Z]:[/\\]/.test(rel)) return false;
    return true;
}

export type FiletreeEntryType = "directory" | "file";

export interface FiletreeEntry {
    name: string;
    path: string;
    type: FiletreeEntryType;
    size?: number;
    mtimeMs: number;
}

export interface FiletreeDirectoryListing {
    workspaceId: string;
    workspacePath: string;
    path: string;
    entries: FiletreeEntry[];
}

export async function listDirectory(
    workspaceId: string,
    requestedPath: string
): Promise<FiletreeDirectoryListing> {
    const workspace = getWorkspace(workspaceId);
    const root = resolve(workspace.path);

    const trimmed = requestedPath.trim().replace(/^[/\\]+/, "");
    const target = trimmed.length === 0 ? root : resolve(root, trimmed);

    if (!isInside(root, target)) {
        throw new Error(`Path is outside the workspace: ${requestedPath}`);
    }

    let dirents: Dirent[];
    try {
        dirents = (await readdir(target, { withFileTypes: true })) as Dirent[];
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to read directory: ${message}`);
    }

    const results = await Promise.all(
        dirents.map(async (d): Promise<FiletreeEntry | null> => {
            if (d.isSymbolicLink()) return null;

            const isDir = d.isDirectory();
            if (!isDir && !d.isFile()) return null;
            if (isDir && HIDDEN_DIR_NAMES.has(d.name)) return null;

            const abs = join(target, d.name);
            let mtimeMs = 0;
            let size: number | undefined;

            try {
                const st = await stat(abs);
                mtimeMs = st.mtimeMs;
                if (!isDir) size = st.size;
            } catch {
                // best-effort stat; entry is still usable without size/mtime
            }

            return {
                name: d.name,
                path: toPosix(relative(root, abs)),
                type: isDir ? "directory" : "file",
                size,
                mtimeMs
            };
        })
    );

    const entries = results.filter((e): e is FiletreeEntry => e !== null);

    entries.sort((a, b) => {
        if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });

    return {
        workspaceId,
        workspacePath: toPosix(root),
        path: toPosix(relative(root, target)),
        entries
    };
}
