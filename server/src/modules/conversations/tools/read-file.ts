import { z } from "zod";
import { readFile, stat } from "node:fs/promises";
import { resolve, join } from "node:path";
import { logger } from "../../../lib/logger";
import type { ToolDefinition } from "./types";

const DEFAULT_MAX_BYTES = 262144;
const HARD_MAX_BYTES = 1048576;

export const readFileInputSchema = z.object({
    path: z
        .string()
        .describe(
            "Path to the file to read. Accepts: (1) absolute paths (e.g. C:\\Users\\foo\\bar.txt), (2) workspace-root-relative paths starting with / or \\ (e.g. /src/index.ts → resolves to <workspace>/src/index.ts), or (3) relative paths (e.g. src/index.ts)."
        ),
    maxBytes: z
        .number()
        .int()
        .positive()
        .max(HARD_MAX_BYTES)
        .optional()
        .describe(
            `Maximum number of bytes to return. Defaults to ${DEFAULT_MAX_BYTES}. Hard cap ${HARD_MAX_BYTES}.`
        )
});

export type ReadFileInput = z.infer<typeof readFileInputSchema>;

export interface ReadFileSuccessOutput {
    path: string;
    size: number;
    bytesRead: number;
    truncated: boolean;
    content: string;
}

function isFullyAbsolute(p: string): boolean {
    // Windows drive-letter path (C:\...) or UNC path (\\server\share)
    if (/^[a-zA-Z]:[/\\]/.test(p) || p.startsWith("\\\\")) return true;
    // Unix absolute path on non-Windows
    if (process.platform !== "win32" && p.startsWith("/")) return true;
    return false;
}

function resolvePath(rawPath: string, workspacePath?: string): string {
    if (isFullyAbsolute(rawPath)) {
        return resolve(rawPath);
    }
    if (!workspacePath) {
        throw new Error(
            `Relative path "${rawPath}" cannot be resolved: no active workspace is open.`
        );
    }
    // Strip leading slash/backslash for workspace-root-relative paths like /claude.md
    const relative = rawPath.replace(/^[/\\]/, "");
    return resolve(join(workspacePath, relative));
}

function looksBinary(buffer: Buffer): boolean {
    const sampleSize = Math.min(buffer.length, 8192);
    for (let i = 0; i < sampleSize; i++) {
        if (buffer[i] === 0) return true;
    }
    return false;
}

function makeExecuteReadFile(workspacePath?: string) {
    return async function executeReadFile(
        input: ReadFileInput
    ): Promise<ReadFileSuccessOutput> {
        const { path: rawPath, maxBytes } = input;
        const limit = maxBytes ?? DEFAULT_MAX_BYTES;

        if (typeof rawPath !== "string" || rawPath.trim().length === 0) {
            throw new Error("path must be a non-empty string");
        }

        const resolved = resolvePath(rawPath, workspacePath);

        let stats;
        try {
            stats = await stat(resolved);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to stat ${resolved}: ${message}`);
        }

        if (!stats.isFile()) {
            throw new Error(`Not a regular file: ${resolved}`);
        }

        const size = stats.size;
        const bytesToRead = Math.min(size, limit);

        let buffer: Buffer;
        try {
            const fullBuffer = (await readFile(resolved)) as Buffer;
            buffer = fullBuffer.subarray(0, bytesToRead);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to read ${resolved}: ${message}`);
        }

        if (looksBinary(buffer)) {
            throw new Error(`Refusing to read binary file: ${resolved}`);
        }

        const content = buffer.toString("utf8");

        logger.log("[tool:read_file]", {
            path: resolved,
            size,
            bytesRead: bytesToRead,
            truncated: bytesToRead < size
        });

        return {
            path: resolved,
            size,
            bytesRead: bytesToRead,
            truncated: bytesToRead < size,
            content
        };
    };
}

export function createReadFileToolDef(workspacePath?: string): ToolDefinition<ReadFileInput, ReadFileSuccessOutput> {
    return {
        name: "read_file",
        description: "Read a text file from the local filesystem. Supports absolute paths and paths relative to the active workspace.",
        inputSchema: readFileInputSchema,
        execute: makeExecuteReadFile(workspacePath)
    };
}

export const readFileToolDef = createReadFileToolDef();
