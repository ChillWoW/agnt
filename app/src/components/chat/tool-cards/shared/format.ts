// Shared formatters and tiny helpers used by multiple tool-card blocks.
// Keep this file pure (no React, no stores) so individual block files can
// import the bits they need without dragging in unrelated dependencies.

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

// Hard cap on detail-string length so a long user pattern (e.g. a sprawling
// glob brace expansion) can't push the tool-call row across the chat column.
// CSS `truncate` on the inner span isn't enough on its own because the button
// row has no width constraint.
export const TOOL_DETAIL_MAX_CHARS = 80;

export function clampDetail(
    text: string,
    maxChars: number = TOOL_DETAIL_MAX_CHARS
): string {
    if (text.length <= maxChars) {
        return text;
    }
    return `${text.slice(0, maxChars - 1)}…`;
}

export function normalizePath(path: string): string {
    return path.replace(/\\/g, "/");
}

export function trimWorkspacePath(
    path: string,
    workspacePath?: string | null
): string {
    const normalizedPath = normalizePath(path);
    const normalizedWorkspace = workspacePath
        ? normalizePath(workspacePath)
        : null;

    if (!normalizedWorkspace) {
        return normalizedPath;
    }

    const lowerPath = normalizedPath.toLowerCase();
    const lowerWorkspace = normalizedWorkspace.toLowerCase();

    if (lowerPath === lowerWorkspace) {
        return "";
    }

    if (lowerPath.startsWith(`${lowerWorkspace}/`)) {
        return normalizedPath.slice(normalizedWorkspace.length + 1);
    }

    return normalizedPath;
}

export function formatReadPath(
    rawPath: string | undefined,
    resolvedPath: string | undefined,
    workspacePath?: string | null
): string | null {
    const preferredPath = resolvedPath ?? rawPath;

    if (!preferredPath) {
        return null;
    }

    const trimmed = trimWorkspacePath(preferredPath, workspacePath);

    if (trimmed.length > 0 && trimmed !== "/") {
        return trimmed.replace(/^\//, "");
    }

    if (rawPath) {
        return normalizePath(rawPath).replace(/^[/\\]/, "");
    }

    return normalizePath(preferredPath);
}

export function truncate(text: string, max: number): string {
    return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

export function formatByteCount(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatCharCount(n: number): string {
    if (n >= 1000) {
        const k = n / 1000;
        return `${k >= 10 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, "")}k chars`;
    }
    return `${n} chars`;
}

export function hostnameOf(url: string): string {
    try {
        return new URL(url).hostname.replace(/^www\./, "");
    } catch {
        return url;
    }
}

export function faviconUrl(url: string): string | null {
    try {
        const host = new URL(url).hostname;
        if (!host) return null;
        return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32`;
    } catch {
        return null;
    }
}

export function formatShellDuration(ms: number | undefined | null): string {
    if (typeof ms !== "number" || !Number.isFinite(ms)) return "";
    if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
    const seconds = ms / 1000;
    if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
    const minutes = Math.floor(seconds / 60);
    const remSec = Math.round(seconds - minutes * 60);
    return `${minutes}m ${remSec}s`;
}
