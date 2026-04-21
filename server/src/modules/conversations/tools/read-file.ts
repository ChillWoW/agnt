import { z } from "zod";
import { readFile, stat } from "node:fs/promises";
import { resolve, join, extname } from "node:path";
import { logger } from "../../../lib/logger";
import type { ToolDefinition, ToolModelOutput } from "./types";

// ─── Limits ───────────────────────────────────────────────────────────────────

/** Default line cap when reading text and no `limit` was provided. */
const DEFAULT_TEXT_LINE_LIMIT = 2000;
/** Hard cap on bytes loaded from disk for a single call (all kinds). */
const HARD_MAX_BYTES = 10 * 1024 * 1024; // 10 MiB
/** Characters per line before each line is snipped in the returned payload. */
const MAX_LINE_CHARS = 2000;

const IMAGE_EXTENSIONS = new Set([
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".webp"
]);

const PDF_EXTENSION = ".pdf";

// ─── Schema ───────────────────────────────────────────────────────────────────

export const readFileInputSchema = z.object({
    path: z
        .string()
        .describe(
            "Path to the file to read. Accepts: (1) absolute paths (e.g. C:\\Users\\foo\\bar.txt), (2) workspace-root-relative paths starting with / or \\ (e.g. /src/index.ts → resolves to <workspace>/src/index.ts), or (3) workspace-relative paths (e.g. src/index.ts)."
        ),
    offset: z
        .number()
        .int()
        .optional()
        .describe(
            "For TEXT files: 1-based line number to start reading from. Negative values count from the end of the file (e.g. -50 reads the last 50 lines with limit=50). Ignored for images and PDFs."
        ),
    limit: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
            `For TEXT files: maximum number of lines to return. Defaults to ${DEFAULT_TEXT_LINE_LIMIT}. Ignored for images and PDFs.`
        )
});

export type ReadFileInput = z.infer<typeof readFileInputSchema>;

// ─── Output shape ─────────────────────────────────────────────────────────────

export type ReadFileKind = "text" | "image" | "pdf";

export interface ReadFileTextOutput {
    kind: "text";
    path: string;
    size: number;
    lineCount: number;
    startLine: number;
    endLine: number;
    truncated: boolean;
    content: string;
}

export interface ReadFileImageOutput {
    kind: "image";
    path: string;
    size: number;
    mediaType: string;
    /** Base-64 encoded image bytes (no data: prefix). */
    data: string;
}

export interface ReadFilePdfOutput {
    kind: "pdf";
    path: string;
    size: number;
    mediaType: "application/pdf";
    /** Base-64 encoded PDF bytes (no data: prefix). */
    data: string;
}

export type ReadFileOutput =
    | ReadFileTextOutput
    | ReadFileImageOutput
    | ReadFilePdfOutput;

// ─── Path + kind helpers ──────────────────────────────────────────────────────

function isFullyAbsolute(p: string): boolean {
    if (/^[a-zA-Z]:[/\\]/.test(p) || p.startsWith("\\\\")) return true;
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
    const relative = rawPath.replace(/^[/\\]/, "");
    return resolve(join(workspacePath, relative));
}

function detectKind(absolutePath: string): ReadFileKind {
    const ext = extname(absolutePath).toLowerCase();
    if (ext === PDF_EXTENSION) return "pdf";
    if (IMAGE_EXTENSIONS.has(ext)) return "image";
    return "text";
}

function imageMediaType(absolutePath: string): string {
    const ext = extname(absolutePath).toLowerCase();
    switch (ext) {
        case ".jpg":
        case ".jpeg":
            return "image/jpeg";
        case ".png":
            return "image/png";
        case ".gif":
            return "image/gif";
        case ".webp":
            return "image/webp";
        default:
            return "application/octet-stream";
    }
}

function looksBinary(buffer: Buffer): boolean {
    const sampleSize = Math.min(buffer.length, 8192);
    for (let i = 0; i < sampleSize; i++) {
        if (buffer[i] === 0) return true;
    }
    return false;
}

// ─── Text rendering ───────────────────────────────────────────────────────────

function splitLines(content: string): string[] {
    if (content.length === 0) return [];
    const normalized = content.replace(/\r\n|\r/g, "\n");
    const lines = normalized.split("\n");
    // Trailing newline → drop the trailing empty element so the line count
    // reflects actual content lines.
    if (lines.length > 0 && lines[lines.length - 1] === "") {
        lines.pop();
    }
    return lines;
}

function formatNumberedLines(
    lines: string[],
    startLine: number
): string {
    // Match the `LINE_NUMBER|LINE_CONTENT` convention the agent already expects.
    // LINE_NUMBER is right-aligned, padded with spaces, 6 characters wide.
    const rendered: string[] = [];
    for (let i = 0; i < lines.length; i++) {
        const lineNumber = startLine + i;
        const prefix = String(lineNumber).padStart(6, " ");
        const rawLine = lines[i] ?? "";
        const clipped =
            rawLine.length > MAX_LINE_CHARS
                ? `${rawLine.slice(0, MAX_LINE_CHARS)} …[truncated ${
                      rawLine.length - MAX_LINE_CHARS
                  } chars]`
                : rawLine;
        rendered.push(`${prefix}|${clipped}`);
    }
    return rendered.join("\n");
}

// ─── Execute ──────────────────────────────────────────────────────────────────

function makeExecuteReadFile(workspacePath?: string) {
    return async function executeReadFile(
        input: ReadFileInput
    ): Promise<ReadFileOutput> {
        const { path: rawPath, offset, limit } = input;

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
        if (size > HARD_MAX_BYTES) {
            throw new Error(
                `File too large: ${size} bytes (max ${HARD_MAX_BYTES}). Use a narrower tool or open the file directly.`
            );
        }

        const kind = detectKind(resolved);
        let buffer: Buffer;
        try {
            buffer = (await readFile(resolved)) as Buffer;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to read ${resolved}: ${message}`);
        }

        if (kind === "image") {
            const output: ReadFileImageOutput = {
                kind: "image",
                path: resolved,
                size,
                mediaType: imageMediaType(resolved),
                data: buffer.toString("base64")
            };
            logger.log("[tool:read_file]", {
                path: resolved,
                kind,
                size
            });
            return output;
        }

        if (kind === "pdf") {
            const output: ReadFilePdfOutput = {
                kind: "pdf",
                path: resolved,
                size,
                mediaType: "application/pdf",
                data: buffer.toString("base64")
            };
            logger.log("[tool:read_file]", {
                path: resolved,
                kind,
                size
            });
            return output;
        }

        // Text path.
        if (looksBinary(buffer)) {
            throw new Error(
                `Refusing to read binary file: ${resolved} (no supported decoder for this type).`
            );
        }

        const raw = buffer.toString("utf8");
        const allLines = splitLines(raw);
        const totalLines = allLines.length;

        // Resolve offset/limit → 1-based inclusive line range.
        const requestedLimit =
            typeof limit === "number" && limit > 0
                ? limit
                : DEFAULT_TEXT_LINE_LIMIT;

        let startLine: number;
        if (typeof offset === "number") {
            if (offset < 0) {
                // Count from the end.
                startLine = Math.max(1, totalLines + offset + 1);
            } else if (offset === 0) {
                startLine = 1;
            } else {
                startLine = offset;
            }
        } else {
            startLine = 1;
        }

        if (startLine > totalLines && totalLines > 0) {
            // Asking past the end → return empty slice but don't error.
            startLine = totalLines + 1;
        }

        const zeroIdxStart = Math.max(0, startLine - 1);
        const zeroIdxEnd = Math.min(totalLines, zeroIdxStart + requestedLimit);
        const slice = allLines.slice(zeroIdxStart, zeroIdxEnd);
        const endLine = slice.length === 0 ? startLine - 1 : startLine + slice.length - 1;
        const truncated =
            totalLines > 0 &&
            (zeroIdxStart > 0 || zeroIdxEnd < totalLines);

        const rendered = formatNumberedLines(slice, startLine);

        const output: ReadFileTextOutput = {
            kind: "text",
            path: resolved,
            size,
            lineCount: totalLines,
            startLine: totalLines === 0 ? 0 : startLine,
            endLine: totalLines === 0 ? 0 : endLine,
            truncated,
            content: rendered
        };

        logger.log("[tool:read_file]", {
            path: resolved,
            kind,
            size,
            lineCount: totalLines,
            startLine: output.startLine,
            endLine: output.endLine,
            truncated
        });

        return output;
    };
}

// ─── Model output transformer ─────────────────────────────────────────────────

function toModelOutput({
    output
}: {
    input: ReadFileInput;
    output: ReadFileOutput;
}): ToolModelOutput {
    if (output.kind === "image") {
        return {
            type: "content",
            value: [
                {
                    type: "text",
                    text: `Image file: ${output.path} (${output.size} bytes, ${output.mediaType}).`
                },
                {
                    type: "image-data",
                    data: output.data,
                    mediaType: output.mediaType
                }
            ]
        };
    }

    if (output.kind === "pdf") {
        return {
            type: "content",
            value: [
                {
                    type: "text",
                    text: `PDF file: ${output.path} (${output.size} bytes).`
                },
                {
                    type: "file-data",
                    data: output.data,
                    mediaType: output.mediaType,
                    filename: output.path.split(/[/\\]/).pop() ?? "file.pdf"
                }
            ]
        };
    }

    // Text: return a JSON envelope (keeps metadata + numbered content) as text
    // so the model sees both the slice range and the numbered payload.
    const header =
        output.lineCount === 0
            ? `File: ${output.path} (empty)`
            : `File: ${output.path} · lines ${output.startLine}-${output.endLine} of ${output.lineCount}${
                  output.truncated ? " (truncated — call again with offset/limit to read more)" : ""
              }`;
    const body = output.content.length > 0 ? `\n${output.content}` : "";
    return {
        type: "text",
        value: `${header}${body}`
    };
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createReadFileToolDef(
    workspacePath?: string
): ToolDefinition<ReadFileInput, ReadFileOutput> {
    return {
        name: "read_file",
        description:
            "Read files from the filesystem (supports text, images jpeg/png/gif/webp, and PDFs). Can read partial files with offset/limit. Text files are returned with `LINE_NUMBER|LINE_CONTENT` formatting. Images and PDFs are returned to the model inline so you can look at them directly.",
        inputSchema: readFileInputSchema,
        execute: makeExecuteReadFile(workspacePath),
        toModelOutput
    };
}

export const readFileToolDef = createReadFileToolDef();
