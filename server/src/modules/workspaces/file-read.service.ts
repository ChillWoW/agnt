import { readFile, stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { getWorkspace } from "./workspaces.service";

const MAX_BYTES = 1_048_576;

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

function looksBinary(buffer: Buffer): boolean {
    const sampleSize = Math.min(buffer.length, 8192);
    for (let i = 0; i < sampleSize; i++) {
        if (buffer[i] === 0) return true;
    }
    return false;
}

export interface WorkspaceFileContent {
    workspaceId: string;
    path: string;
    size: number;
    bytesRead: number;
    truncated: boolean;
    binary: boolean;
    content: string;
    mtimeMs: number;
}

export async function readWorkspaceFile(
    workspaceId: string,
    requestedPath: string
): Promise<WorkspaceFileContent> {
    const workspace = getWorkspace(workspaceId);
    const root = resolve(workspace.path);

    const trimmed = requestedPath.trim().replace(/^[/\\]+/, "");
    if (trimmed.length === 0) {
        throw new Error("path is required");
    }

    const target = resolve(root, trimmed);
    if (!isInside(root, target)) {
        throw new Error(`Path is outside the workspace: ${requestedPath}`);
    }

    const stats = await stat(target);
    if (!stats.isFile()) {
        throw new Error(`Not a regular file: ${requestedPath}`);
    }

    const size = stats.size;
    const bytesToRead = Math.min(size, MAX_BYTES);

    const fullBuffer = (await readFile(target)) as Buffer;
    const buffer = fullBuffer.subarray(0, bytesToRead);
    const binary = looksBinary(buffer);

    return {
        workspaceId,
        path: toPosix(relative(root, target)),
        size,
        bytesRead: bytesToRead,
        truncated: bytesToRead < size,
        binary,
        content: binary ? "" : buffer.toString("utf8"),
        mtimeMs: stats.mtimeMs
    };
}
