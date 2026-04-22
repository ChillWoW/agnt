import { z } from "zod";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { logger } from "../../../lib/logger";
import type { ToolDefinition } from "./types";
import { resolveWorkspacePath, toPosix } from "./workspace-path";

// ─── Limits ───────────────────────────────────────────────────────────────────

/** Hard cap on the size of a single write (UTF-8 bytes). */
const HARD_MAX_BYTES = 10 * 1024 * 1024; // 10 MiB

// ─── Schema ───────────────────────────────────────────────────────────────────

export const writeInputSchema = z.object({
    path: z
        .string()
        .min(1)
        .describe(
            'Path to the file to write. Resolved against the active workspace and MUST stay inside it. Accepts: (1) workspace-root-relative paths starting with "/" or "\\" (e.g. "/src/index.ts"), (2) workspace-relative paths (e.g. "src/index.ts"), or (3) absolute paths if they live inside the workspace. Parent directories are created automatically.'
        ),
    contents: z
        .string()
        .describe(
            "Full UTF-8 text contents of the file. The file is created if missing or overwritten in full if it already exists — this tool does NOT patch or append. When editing a file that already exists, PREFER the `str_replace` tool to avoid rewriting unchanged content."
        )
});

export type WriteInput = z.infer<typeof writeInputSchema>;

// ─── Output shape ─────────────────────────────────────────────────────────────

export interface WriteOutput {
    ok: true;
    path: string;
    relativePath: string;
    bytesWritten: number;
    lineCount: number;
    created: boolean;
    previousSize: number | null;
    createdDirectories: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function fileExists(absolutePath: string): Promise<{
    exists: boolean;
    isFile: boolean;
    size: number;
}> {
    try {
        const s = await stat(absolutePath);
        return { exists: true, isFile: s.isFile(), size: s.size };
    } catch (error) {
        if (
            error &&
            typeof error === "object" &&
            "code" in error &&
            (error as NodeJS.ErrnoException).code === "ENOENT"
        ) {
            return { exists: false, isFile: false, size: 0 };
        }
        throw error;
    }
}

async function ensureDirectory(
    absoluteDir: string,
    workspaceRoot: string
): Promise<string[]> {
    // Walk up from absoluteDir, collecting missing ancestors that live inside
    // the workspace. Report them so the agent can see what it just created.
    const created: string[] = [];
    const root = resolve(workspaceRoot);
    const visited: string[] = [];
    let cursor = absoluteDir;
    while (
        cursor.length > 0 &&
        cursor.startsWith(root) &&
        cursor !== root
    ) {
        visited.push(cursor);
        const parent = dirname(cursor);
        if (parent === cursor) break;
        cursor = parent;
    }

    // Walk from the deepest missing ancestor down to the target directory.
    for (const dir of visited.reverse()) {
        try {
            await stat(dir);
        } catch (error) {
            if (
                error &&
                typeof error === "object" &&
                "code" in error &&
                (error as NodeJS.ErrnoException).code === "ENOENT"
            ) {
                created.push(dir);
            } else {
                throw error;
            }
        }
    }

    if (created.length === 0) return [];
    await mkdir(absoluteDir, { recursive: true });
    return created.map((p) => toPosix(relative(root, p)));
}

function countLines(contents: string): number {
    if (contents.length === 0) return 0;
    const normalized = contents.replace(/\r\n|\r/g, "\n");
    const parts = normalized.split("\n");
    if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
    return parts.length;
}

// ─── Execute ──────────────────────────────────────────────────────────────────

function makeExecuteWrite(workspacePath?: string) {
    return async function executeWrite(
        input: WriteInput
    ): Promise<WriteOutput> {
        const { path: rawPath, contents } = input;

        const byteLength = Buffer.byteLength(contents, "utf8");
        if (byteLength > HARD_MAX_BYTES) {
            throw new Error(
                `Refusing to write ${byteLength} bytes: exceeds ${HARD_MAX_BYTES}-byte cap. Split the content or use a narrower tool.`
            );
        }

        const { absolute, relative: relPath } = resolveWorkspacePath(
            rawPath,
            workspacePath,
            "write"
        );

        const existing = await fileExists(absolute);
        if (existing.exists && !existing.isFile) {
            throw new Error(
                `Refusing to write: path exists but is not a regular file: ${absolute}`
            );
        }

        // Preserve existing line-ending convention when overwriting a text file
        // whose content the model likely received from `read_file` (which
        // normalizes CRLF/CR → LF). Avoids silently flipping a CRLF file to LF.
        let finalContents = contents;
        if (existing.exists && existing.isFile) {
            try {
                const raw = await readFile(absolute);
                const prev = raw.toString("utf8");
                const hasCrlf = /\r\n/.test(prev);
                const incomingHasCrlf = /\r\n/.test(finalContents);
                if (hasCrlf && !incomingHasCrlf) {
                    finalContents = finalContents.replace(/\n/g, "\r\n");
                }
            } catch (error) {
                // Unreadable (binary, permissions) — fall through and write as-is.
                logger.log("[tool:write] could not inspect existing file", {
                    path: absolute,
                    error:
                        error instanceof Error ? error.message : String(error)
                });
            }
        }

        const createdDirectories = await ensureDirectory(
            dirname(absolute),
            workspacePath ?? resolve(absolute).split(sep).slice(0, 1).join(sep)
        );

        try {
            await writeFile(absolute, finalContents, "utf8");
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to write ${absolute}: ${message}`);
        }

        const bytesWritten = Buffer.byteLength(finalContents, "utf8");

        const output: WriteOutput = {
            ok: true,
            path: absolute,
            relativePath: toPosix(relPath),
            bytesWritten,
            lineCount: countLines(finalContents),
            created: !existing.exists,
            previousSize: existing.exists ? existing.size : null,
            createdDirectories
        };

        logger.log("[tool:write]", {
            path: absolute,
            bytesWritten,
            created: output.created,
            previousSize: output.previousSize,
            createdDirectories: createdDirectories.length
        });

        return output;
    };
}

// ─── Description ──────────────────────────────────────────────────────────────

const TOOL_DESCRIPTION =
    "Create a new file or overwrite an existing one with the provided contents. " +
    "ALWAYS PREFER editing existing files via `str_replace` over rewriting them with `write`; only use `write` when creating a new file or when a full rewrite is genuinely simpler than a patch. " +
    "Paths must resolve inside the active workspace; missing parent directories are created automatically. " +
    "When overwriting a file that already uses CRLF line endings, CRLF is preserved even if the incoming `contents` use LF. " +
    "This tool does NOT append, patch, or merge — the file is replaced in full. " +
    "Never use this tool to write binary data, lockfiles, or other files generated by tooling (e.g. `routeTree.gen.ts`, `bun.lock`).";

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createWriteToolDef(
    workspacePath?: string
): ToolDefinition<WriteInput, WriteOutput> {
    return {
        name: "write",
        description: TOOL_DESCRIPTION,
        inputSchema: writeInputSchema,
        execute: makeExecuteWrite(workspacePath)
    };
}

export const writeToolDef = createWriteToolDef();
