import { readdir, readFile, stat } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { join, relative } from "node:path";
import { z } from "zod";
import { logger } from "../../../lib/logger";
import type { ToolDefinition } from "./types";
import {
    IGNORED_DIR_SEGMENTS,
    resolveWorkspacePath,
    toPosix
} from "./workspace-path";

const DEFAULT_MAX_RESULTS = 100;
const HARD_MAX_RESULTS = 1_000;
const MAX_FILE_BYTES = 1_048_576; // 1 MB per file
const MAX_TOTAL_BYTES = 52_428_800; // 50 MB scanned total
const HARD_MAX_ENTRIES_SCANNED = 50_000;
const MAX_LINE_LENGTH = 400;

export const grepInputSchema = z.object({
    pattern: z
        .string()
        .min(1)
        .describe(
            'Regular expression to search for (JavaScript regex syntax). Literal strings should escape regex metacharacters, e.g. "foo\\.bar".'
        ),
    path: z
        .string()
        .optional()
        .describe(
            'Optional subdirectory to search in, resolved against the workspace (same rules as read_file / glob: "/src" for workspace-relative, relative paths resolve against the workspace, absolute paths must live inside the workspace). Defaults to the workspace root.'
        ),
    include: z
        .string()
        .optional()
        .describe(
            'Optional glob that file paths (relative to the search root) must match, e.g. "**/*.ts" or "src/**/*.{ts,tsx}". Defaults to "**/*" (all files).'
        ),
    caseInsensitive: z
        .boolean()
        .optional()
        .describe("When true, the regex is compiled with the 'i' flag."),
    maxResults: z
        .number()
        .int()
        .positive()
        .max(HARD_MAX_RESULTS)
        .optional()
        .describe(
            `Maximum number of matching lines to return. Defaults to ${DEFAULT_MAX_RESULTS}, hard cap ${HARD_MAX_RESULTS}.`
        )
});

export type GrepInput = z.infer<typeof grepInputSchema>;

export interface GrepMatch {
    file: string;
    line: number;
    text: string;
}

export interface GrepOutput {
    searchRoot: string;
    pattern: string;
    include: string;
    matches: GrepMatch[];
    matchCount: number;
    filesMatched: number;
    filesScanned: number;
    bytesScanned: number;
    truncated: boolean;
    byteLimitHit: boolean;
    scanLimitHit: boolean;
}

function validateIncludePattern(pattern: string): void {
    const normalized = toPosix(pattern).trim();
    if (normalized.length === 0) {
        throw new Error("include glob is empty");
    }
    if (normalized.startsWith("/") || /^[a-zA-Z]:\//.test(normalized)) {
        throw new Error(
            "include glob must be relative to the search root (do not start with / or a drive letter)"
        );
    }
    if (normalized.split("/").some((seg) => seg === "..")) {
        throw new Error('include glob must not contain ".." segments');
    }
}

function compileRegex(pattern: string, caseInsensitive: boolean): RegExp {
    try {
        return new RegExp(pattern, caseInsensitive ? "i" : "");
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Invalid regex: ${message}`);
    }
}

function looksBinary(buffer: Buffer): boolean {
    const sample = Math.min(buffer.length, 8192);
    for (let i = 0; i < sample; i++) {
        if (buffer[i] === 0) return true;
    }
    return false;
}

function truncateLine(line: string): string {
    if (line.length <= MAX_LINE_LENGTH) return line;
    return `${line.slice(0, MAX_LINE_LENGTH)}…`;
}

async function* walkFiles(
    root: string,
    maxEntries: number
): AsyncGenerator<
    { absolute: string; relative: string },
    { scanLimitHit: boolean; entriesScanned: number }
> {
    let scanned = 0;
    const stack: string[] = [root];

    while (stack.length > 0) {
        const dir = stack.pop()!;

        let entries: Dirent[];
        try {
            entries = (await readdir(dir, { withFileTypes: true })) as Dirent[];
        } catch (error) {
            logger.log("[tool:grep] readdir failed", {
                dir,
                error: error instanceof Error ? error.message : String(error)
            });
            continue;
        }

        for (const entry of entries) {
            scanned += 1;
            if (scanned > maxEntries) {
                return { scanLimitHit: true, entriesScanned: scanned - 1 };
            }

            const abs = join(dir, entry.name);

            if (entry.isSymbolicLink()) continue;

            if (entry.isDirectory()) {
                if (IGNORED_DIR_SEGMENTS.includes(entry.name)) continue;
                stack.push(abs);
                continue;
            }

            if (!entry.isFile()) continue;

            yield { absolute: abs, relative: relative(root, abs) };
        }
    }

    return { scanLimitHit: false, entriesScanned: scanned };
}

function makeExecuteGrep(workspacePath?: string) {
    return async function executeGrep(input: GrepInput): Promise<GrepOutput> {
        const {
            pattern,
            path: rawPath,
            include,
            caseInsensitive,
            maxResults
        } = input;

        const cap = maxResults ?? DEFAULT_MAX_RESULTS;
        const includeGlob = include ?? "**/*";
        validateIncludePattern(includeGlob);

        const regex = compileRegex(pattern, caseInsensitive ?? false);

        const { absolute: searchRoot } = resolveWorkspacePath(
            rawPath,
            workspacePath,
            "grep"
        );

        const includeMatcher = new Bun.Glob(toPosix(includeGlob));

        const matches: GrepMatch[] = [];
        const matchedFiles = new Set<string>();
        let bytesScanned = 0;
        let filesScanned = 0;
        let truncated = false;
        let byteLimitHit = false;
        let scanLimitHit = false;
        let entriesScanned = 0;

        outer: {
            const iterator = walkFiles(searchRoot, HARD_MAX_ENTRIES_SCANNED);
            while (true) {
                const next = await iterator.next();
                if (next.done) {
                    scanLimitHit = next.value?.scanLimitHit ?? false;
                    entriesScanned =
                        next.value?.entriesScanned ?? entriesScanned;
                    break;
                }
                entriesScanned += 1;
                const { absolute, relative: rel } = next.value;
                const relPosix = toPosix(rel);

                if (!includeMatcher.match(relPosix)) continue;

                let stats;
                try {
                    stats = await stat(absolute);
                } catch {
                    continue;
                }
                if (!stats.isFile()) continue;
                if (stats.size === 0) continue;
                if (stats.size > MAX_FILE_BYTES) continue;

                if (bytesScanned + stats.size > MAX_TOTAL_BYTES) {
                    byteLimitHit = true;
                    break outer;
                }

                let buffer: Buffer;
                try {
                    buffer = (await readFile(absolute)) as Buffer;
                } catch {
                    continue;
                }

                if (looksBinary(buffer)) continue;

                filesScanned += 1;
                bytesScanned += buffer.length;

                const content = buffer.toString("utf8");
                const lines = content.split(/\r\n|\r|\n/);

                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i]!;
                    // Reset lastIndex is unnecessary since we don't use the /g flag.
                    if (!regex.test(line)) continue;

                    matches.push({
                        file: relPosix,
                        line: i + 1,
                        text: truncateLine(line)
                    });
                    matchedFiles.add(relPosix);

                    if (matches.length >= cap) {
                        truncated = true;
                        break outer;
                    }
                }
            }
        }

        matches.sort((a, b) => {
            if (a.file === b.file) return a.line - b.line;
            return a.file.localeCompare(b.file);
        });

        logger.log("[tool:grep]", {
            searchRoot,
            pattern,
            include: includeGlob,
            caseInsensitive: !!caseInsensitive,
            matchCount: matches.length,
            filesMatched: matchedFiles.size,
            filesScanned,
            bytesScanned,
            truncated,
            byteLimitHit,
            scanLimitHit
        });

        return {
            searchRoot,
            pattern,
            include: includeGlob,
            matches,
            matchCount: matches.length,
            filesMatched: matchedFiles.size,
            filesScanned,
            bytesScanned,
            truncated,
            byteLimitHit,
            scanLimitHit
        };
    };
}

export function createGrepToolDef(
    workspacePath?: string
): ToolDefinition<GrepInput, GrepOutput> {
    return {
        name: "grep",
        description:
            "Search file contents with a regex within the workspace. Skips node_modules, .git, and other build/cache dirs. Binary files, empty files, and files larger than 1MB are skipped. Use 'include' to narrow to a glob like '**/*.ts'.",
        inputSchema: grepInputSchema,
        execute: makeExecuteGrep(workspacePath)
    };
}

export const grepToolDef = createGrepToolDef();
