import { relative, resolve, sep } from "node:path";
import { logger } from "../../../lib/logger";
import { getCategory } from "../../settings/settings.service";

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
 * Read `general.restrictToolsToWorkspace` from settings, defaulting to `true`
 * if anything goes wrong (best-effort, so a broken settings.json never opens
 * up the host filesystem on accident).
 */
function isWorkspaceRestrictionEnabled(): boolean {
    try {
        const general = getCategory("general");
        if (typeof general?.restrictToolsToWorkspace === "boolean") {
            return general.restrictToolsToWorkspace;
        }
    } catch (error) {
        logger.error("[workspace-path] failed to load general settings", error);
    }
    return true;
}

/**
 * Resolve a user-supplied path against the active workspace.
 *
 * Path resolution rules (mirroring read_file):
 *   - leading "/" or "\\"  → workspace-root-relative (e.g. "/src/foo.ts")
 *   - fully absolute path  → kept as-is (subject to the boundary check below)
 *   - relative path        → resolved against the workspace root
 *   - undefined / empty    → workspace root itself
 *
 * Boundary check:
 *   When `general.restrictToolsToWorkspace` is `true` (the default), the
 *   final absolute path must live inside the workspace root — this is what
 *   prevents glob/grep/write/etc from accidentally walking the whole disk.
 *   When the setting is `false`, the boundary check is skipped and any
 *   fully absolute path on the host is accepted (relative paths still
 *   resolve against the workspace because they have nothing else to anchor
 *   to).
 */
export function resolveWorkspacePath(
    rawPath: string | undefined,
    workspacePath: string | undefined,
    toolName: string
): ResolvedWorkspacePath {
    const trimmed = typeof rawPath === "string" ? rawPath.trim() : "";
    const restrictionEnabled = isWorkspaceRestrictionEnabled();

    // No workspace open: the only thing we can resolve is a fully absolute
    // path while the restriction is OFF. Everything else still needs a
    // workspace as an anchor.
    if (!workspacePath) {
        if (!restrictionEnabled && trimmed.length > 0 && isFullyAbsolute(trimmed)) {
            const absolute = resolve(trimmed);
            return { absolute, relative: absolute };
        }
        throw new Error(
            `Tool "${toolName}" requires an open workspace. Open a workspace folder and try again.`
        );
    }

    const root = resolve(workspacePath);

    let absolute: string;
    if (trimmed.length === 0) {
        absolute = root;
    } else if (isFullyAbsolute(trimmed)) {
        absolute = resolve(trimmed);
    } else {
        const stripped = trimmed.replace(/^[/\\]+/, "");
        absolute = resolve(root, stripped);
    }

    if (restrictionEnabled && !isInside(root, absolute)) {
        throw new Error(
            `Tool "${toolName}" refuses path outside the workspace: ${absolute}. ` +
                `Use a workspace-relative path (e.g. "/src" or "src/foo.ts"), ` +
                `or disable "Restrict tools to workspace" in Settings → General.`
        );
    }

    const rel = isInside(root, absolute) ? relative(root, absolute) : absolute;
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
