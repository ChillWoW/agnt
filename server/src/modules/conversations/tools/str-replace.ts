import { z } from "zod";
import { readFile, stat, writeFile } from "node:fs/promises";
import { logger } from "../../../lib/logger";
import type { ToolDefinition, ToolModelOutput } from "./types";
import { resolveWorkspacePath, toPosix } from "./workspace-path";
import type { DiagnosticsResult } from "../../lsp/lsp.types";
import {
    runPostEditDiagnostics,
    summarizeDiagnosticsForModel
} from "./post-edit-diagnostics";

// ─── Limits ───────────────────────────────────────────────────────────────────

/** Hard cap on the file size we'll operate on. */
const HARD_MAX_BYTES = 10 * 1024 * 1024; // 10 MiB

// ─── Schema ───────────────────────────────────────────────────────────────────

export const strReplaceInputSchema = z.object({
    path: z
        .string()
        .min(1)
        .describe(
            'Path to the file to edit. Resolved against the active workspace and MUST stay inside it. Accepts: (1) workspace-root-relative paths starting with "/" or "\\" (e.g. "/src/index.ts"), (2) workspace-relative paths (e.g. "src/index.ts"), or (3) absolute paths if they live inside the workspace. The file must already exist.'
        ),
    old_string: z
        .string()
        .min(1)
        .describe(
            "Exact text to find and replace. Must match verbatim (whitespace and indentation included). When `replace_all` is false (default) this string MUST occur exactly ONCE — include 3–5 lines of surrounding context if needed to make it unique. Line endings are matched flexibly against both LF and CRLF."
        ),
    new_string: z
        .string()
        .describe(
            "Replacement text. May be empty to delete the `old_string`. Must differ from `old_string` unless that would be a no-op rename (which is rejected)."
        ),
    replace_all: z
        .boolean()
        .optional()
        .default(false)
        .describe(
            "When true, replace EVERY occurrence of `old_string`. Use this for renaming an identifier across the file. When false (default), exactly one occurrence is required and the call fails otherwise."
        )
});

export type StrReplaceInput = z.infer<typeof strReplaceInputSchema>;

// ─── Output shape ─────────────────────────────────────────────────────────────

export interface StrReplaceOutput {
    ok: true;
    path: string;
    relativePath: string;
    replacements: number;
    replaceAll: boolean;
    bytesBefore: number;
    bytesAfter: number;
    /** True when `old_string` was normalized to match the file's CRLF endings. */
    crlfNormalized: boolean;
    /** See `WriteOutput.diagnostics` for semantics. */
    diagnostics?: DiagnosticsResult;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function countOccurrences(haystack: string, needle: string): number {
    if (needle.length === 0) return 0;
    let count = 0;
    let from = 0;
    while (true) {
        const idx = haystack.indexOf(needle, from);
        if (idx === -1) break;
        count += 1;
        from = idx + needle.length;
    }
    return count;
}

function looksBinary(buffer: Buffer): boolean {
    const sampleSize = Math.min(buffer.length, 8192);
    for (let i = 0; i < sampleSize; i++) {
        if (buffer[i] === 0) return true;
    }
    return false;
}

function toCrlf(s: string): string {
    // Only convert bare "\n" → "\r\n"; leave existing CRLF intact.
    return s.replace(/\r\n|\n/g, "\r\n");
}

// ─── Execute ──────────────────────────────────────────────────────────────────

function makeExecuteStrReplace(workspacePath?: string) {
    return async function executeStrReplace(
        input: StrReplaceInput
    ): Promise<StrReplaceOutput> {
        const {
            path: rawPath,
            old_string: oldString,
            new_string: newString,
            replace_all: replaceAllRaw
        } = input;
        const replaceAll = replaceAllRaw ?? false;

        if (oldString === newString) {
            throw new Error(
                "`old_string` and `new_string` are identical — this would be a no-op. Did you mean to write a different replacement?"
            );
        }

        const { absolute, relative: relPath } = resolveWorkspacePath(
            rawPath,
            workspacePath,
            "str_replace"
        );

        let stats;
        try {
            stats = await stat(absolute);
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            throw new Error(
                `Failed to open ${absolute}: ${message}. Use the \`write\` tool to create a new file.`
            );
        }
        if (!stats.isFile()) {
            throw new Error(`Not a regular file: ${absolute}`);
        }
        if (stats.size > HARD_MAX_BYTES) {
            throw new Error(
                `File too large for str_replace: ${stats.size} bytes (max ${HARD_MAX_BYTES}).`
            );
        }

        let buffer: Buffer;
        try {
            buffer = (await readFile(absolute)) as Buffer;
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to read ${absolute}: ${message}`);
        }

        if (looksBinary(buffer)) {
            throw new Error(
                `Refusing to edit binary file: ${absolute}. str_replace only operates on text files.`
            );
        }

        const before = buffer.toString("utf8");
        const bytesBefore = buffer.length;

        // Line-ending handling: if the file contains CRLF but the incoming
        // `old_string`/`new_string` use LF only, normalize them to CRLF before
        // searching so models can quote text they read through `read_file`
        // (which normalizes to LF) without mismatching against the actual file.
        const fileHasCrlf = /\r\n/.test(before);
        const incomingOldHasCrlf = /\r\n/.test(oldString);
        const incomingOldHasBareLf = /(?<!\r)\n/.test(oldString);
        const shouldNormalize =
            fileHasCrlf && !incomingOldHasCrlf && incomingOldHasBareLf;

        let searchNeedle = oldString;
        let replacementValue = newString;
        let firstOccurrences = countOccurrences(before, searchNeedle);

        let crlfNormalized = false;
        if (firstOccurrences === 0 && shouldNormalize) {
            searchNeedle = toCrlf(oldString);
            replacementValue = toCrlf(newString);
            firstOccurrences = countOccurrences(before, searchNeedle);
            crlfNormalized = firstOccurrences > 0;
        }

        if (firstOccurrences === 0) {
            throw new Error(
                `\`old_string\` not found in ${absolute}. Check exact whitespace/indentation and line breaks (the file is ${
                    fileHasCrlf ? "CRLF" : "LF"
                }).`
            );
        }

        if (!replaceAll && firstOccurrences > 1) {
            throw new Error(
                `\`old_string\` occurs ${firstOccurrences} times in ${absolute}; add surrounding context to make it unique, or pass \`replace_all: true\` to replace every occurrence.`
            );
        }

        let after: string;
        let replacements: number;
        if (replaceAll) {
            after = before.split(searchNeedle).join(replacementValue);
            replacements = firstOccurrences;
        } else {
            const idx = before.indexOf(searchNeedle);
            after =
                before.slice(0, idx) +
                replacementValue +
                before.slice(idx + searchNeedle.length);
            replacements = 1;
        }

        try {
            await writeFile(absolute, after, "utf8");
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to write ${absolute}: ${message}`);
        }

        const bytesAfter = Buffer.byteLength(after, "utf8");

        const diagnostics = await runPostEditDiagnostics(workspacePath, [absolute]);

        logger.log("[tool:str_replace]", {
            path: absolute,
            replacements,
            replaceAll,
            bytesBefore,
            bytesAfter,
            crlfNormalized,
            diagnostics: diagnostics
                ? {
                      errors: diagnostics.summary.errors,
                      warnings: diagnostics.summary.warnings
                  }
                : undefined
        });

        const output: StrReplaceOutput = {
            ok: true,
            path: absolute,
            relativePath: toPosix(relPath),
            replacements,
            replaceAll,
            bytesBefore,
            bytesAfter,
            crlfNormalized
        };
        if (diagnostics) output.diagnostics = diagnostics;
        return output;
    };
}

// ─── Model output ─────────────────────────────────────────────────────────────

function toStrReplaceModelOutput({
    output
}: {
    input: StrReplaceInput;
    output: StrReplaceOutput;
}): ToolModelOutput {
    const lines: string[] = [];
    const plural = output.replacements === 1 ? "" : "s";
    lines.push(
        `Edited ${output.relativePath} (${output.replacements} replacement${plural}, ${output.bytesBefore} → ${output.bytesAfter} bytes).`
    );
    const lspSummary = summarizeDiagnosticsForModel(output.diagnostics);
    if (lspSummary) lines.push(lspSummary);
    return { type: "text", value: lines.join("\n") };
}

// ─── Description ──────────────────────────────────────────────────────────────

const TOOL_DESCRIPTION =
    "Perform an exact string replacement in an existing text file. PREFER this over `write` for edits — it keeps the untouched portion of the file byte-identical. " +
    "`old_string` must match the file verbatim including whitespace and indentation; include 3–5 lines of surrounding context so the match is unique. " +
    "When `replace_all` is false (default), the tool fails unless `old_string` occurs exactly ONCE; set `replace_all: true` for file-wide rename-style edits. " +
    "Line endings are matched flexibly: if the file uses CRLF but the incoming `old_string` uses LF, both `old_string` and `new_string` are transparently normalized to CRLF so edits don't silently flip line-ending style. " +
    "Fails on binary files and on files that don't exist (use `write` to create a new file).";

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createStrReplaceToolDef(
    workspacePath?: string
): ToolDefinition<StrReplaceInput, StrReplaceOutput> {
    return {
        name: "str_replace",
        description: TOOL_DESCRIPTION,
        inputSchema: strReplaceInputSchema,
        execute: makeExecuteStrReplace(workspacePath),
        toModelOutput: toStrReplaceModelOutput
    };
}

export const strReplaceToolDef = createStrReplaceToolDef();
