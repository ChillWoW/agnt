import { relative, resolve, sep } from "node:path";

const DEFAULT_IGNORED_DIR_SEGMENTS = [
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
    ".nyc_output",
    ".idea",
    ".vscode"
] as const;

export const IGNORED_DIR_SEGMENTS: readonly string[] =
    DEFAULT_IGNORED_DIR_SEGMENTS;

function isFullyAbsolute(p: string): boolean {
    if (/^[a-zA-Z]:[/\\]/.test(p) || p.startsWith("\\\\")) return true;
    if (process.platform !== "win32" && p.startsWith("/")) return true;
    return false;
}

function isInside(parent: string, child: string): boolean {
    const rel = relative(parent, child);
    if (rel === "") return true;
    if (rel.startsWith("..")) return false;
    // On Windows, relative() across drives returns an absolute path.
    if (/^[a-zA-Z]:[/\\]/.test(rel)) return false;
    return true;
}

export interface ResolvedWorkspacePath {
    absolute: string;
    relative: string;
}

/**
 * Resolve a user-supplied path against the active workspace. Enforces that the
 * final path lives inside the workspace root — this is the safeguard that
 * prevents glob/grep from accidentally walking the whole filesystem.
 *
 * Path resolution rules (mirroring read_file):
 *   - leading "/" or "\\"  → workspace-root-relative (e.g. "/src/foo.ts")
 *   - fully absolute path  → accepted only if it is inside the workspace
 *   - relative path        → resolved against the workspace root
 *   - undefined / empty    → workspace root itself
 */
export function resolveWorkspacePath(
    rawPath: string | undefined,
    workspacePath: string | undefined,
    toolName: string
): ResolvedWorkspacePath {
    if (!workspacePath) {
        throw new Error(
            `Tool "${toolName}" requires an open workspace. Open a workspace folder and try again.`
        );
    }

    const root = resolve(workspacePath);

    const trimmed = typeof rawPath === "string" ? rawPath.trim() : "";

    let absolute: string;
    if (trimmed.length === 0) {
        absolute = root;
    } else if (isFullyAbsolute(trimmed)) {
        absolute = resolve(trimmed);
    } else {
        const stripped = trimmed.replace(/^[/\\]+/, "");
        absolute = resolve(root, stripped);
    }

    if (!isInside(root, absolute)) {
        throw new Error(
            `Tool "${toolName}" refuses path outside the workspace: ${absolute}. ` +
                `Use a workspace-relative path (e.g. "/src" or "src/foo.ts").`
        );
    }

    const rel = relative(root, absolute);
    return {
        absolute,
        relative: rel
    };
}

export function toPosix(p: string): string {
    return sep === "\\" ? p.replace(/\\/g, "/") : p;
}

/**
 * Returns true when any path segment matches one of the default-ignored
 * directory names (e.g. node_modules, .git). Used to prune traversal in
 * glob/grep so we don't waste CPU on caches and vendor dirs.
 */
export function isIgnoredPath(relPath: string): boolean {
    if (relPath.length === 0) return false;
    const segments = relPath.split(/[\\/]/);
    for (const seg of segments) {
        if (!seg || seg === ".") continue;
        if (IGNORED_DIR_SEGMENTS.includes(seg)) return true;
    }
    return false;
}
