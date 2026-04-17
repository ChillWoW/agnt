import { z } from "zod";
import { readFile, stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { logger } from "../../../lib/logger";
import type { ToolDefinition } from "./types";

const DEFAULT_MAX_BYTES = 262144;
const HARD_MAX_BYTES = 1048576;

export const readFileInputSchema = z.object({
    path: z
        .string()
        .describe(
            "Absolute filesystem path to the file to read. Must be absolute (e.g. C:\\Users\\foo\\bar.txt on Windows or /home/foo/bar.txt on Unix)."
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

function looksBinary(buffer: Buffer): boolean {
    const sampleSize = Math.min(buffer.length, 8192);
    for (let i = 0; i < sampleSize; i++) {
        if (buffer[i] === 0) return true;
    }
    return false;
}

async function executeReadFile(
    input: ReadFileInput
): Promise<ReadFileSuccessOutput> {
    const { path: rawPath, maxBytes } = input;
    const limit = maxBytes ?? DEFAULT_MAX_BYTES;

    if (typeof rawPath !== "string" || rawPath.trim().length === 0) {
        throw new Error("path must be a non-empty string");
    }

    if (!isAbsolute(rawPath)) {
        throw new Error(`path must be absolute, received: ${rawPath}`);
    }

    const resolved = resolve(rawPath);

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
}

export const readFileToolDef: ToolDefinition<
    ReadFileInput,
    ReadFileSuccessOutput
> = {
    name: "read_file",
    description:
        "Read the contents of a text file from the user's local filesystem. Use this when the user references a specific file or asks about its contents. The path must be absolute. Binary files are refused. Large files are truncated to the requested byte cap.",
    inputSchema: readFileInputSchema,
    execute: executeReadFile
};
