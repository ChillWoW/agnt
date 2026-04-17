import { readdir } from "node:fs/promises";
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

const DEFAULT_LIMIT = 100;
const HARD_MAX_LIMIT = 500;
const HARD_MAX_ENTRIES_SCANNED = 50_000;

export const globInputSchema = z.object({
    pattern: z
        .string()
        .min(1)
        .describe(
            'Glob pattern relative to the search root, e.g. "**/*.ts" or "src/**/*.tsx". Follows standard glob syntax (*, **, ?, {a,b}, [abc]).'
        ),
    path: z
        .string()
        .optional()
        .describe(
            'Optional subdirectory to search in, resolved against the workspace. Accepts a workspace-root-relative path (e.g. "/src") or a path relative to the workspace. Absolute paths are only accepted if they live inside the workspace. Defaults to the workspace root.'
        ),
    limit: z
        .number()
        .int()
        .positive()
        .max(HARD_MAX_LIMIT)
        .optional()
        .describe(
            `Maximum number of matches to return. Defaults to ${DEFAULT_LIMIT}, hard cap ${HARD_MAX_LIMIT}.`
        )
});

export type GlobInput = z.infer<typeof globInputSchema>;

export interface GlobOutput {
    searchRoot: string;
    pattern: string;
    matches: string[];
    matchCount: number;
    truncated: boolean;
    entriesScanned: number;
    scanLimitHit: boolean;
}

function validatePattern(pattern: string): void {
    if (pattern.includes("\0")) {
        throw new Error("glob pattern contains NUL byte");
    }
    const normalized = toPosix(pattern).trim();
    if (normalized.length === 0) {
        throw new Error("glob pattern is empty");
    }
    if (normalized.startsWith("/") || /^[a-zA-Z]:\//.test(normalized)) {
        throw new Error(
            "glob pattern must be relative to the search root (do not start with / or a drive letter)"
        );
    }
    if (normalized.split("/").some((seg) => seg === "..")) {
        throw new Error(
            'glob pattern must not contain ".." segments (stay inside the search root)'
        );
    }
}

async function* walkFiles(
    root: string,
    maxEntries: number
): AsyncGenerator<{ absolute: string; relative: string }, { scanLimitHit: boolean; entriesScanned: number }> {
    let scanned = 0;
    const stack: string[] = [root];

    while (stack.length > 0) {
        const dir = stack.pop()!;

        let entries: Dirent[];
        try {
            entries = (await readdir(dir, { withFileTypes: true })) as Dirent[];
        } catch (error) {
            logger.log("[tool:glob] readdir failed", {
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

            if (entry.isSymbolicLink()) {
                continue;
            }

            if (entry.isDirectory()) {
                if (IGNORED_DIR_SEGMENTS.includes(entry.name)) {
                    continue;
                }
                stack.push(abs);
                continue;
            }

            if (!entry.isFile()) continue;

            yield { absolute: abs, relative: relative(root, abs) };
        }
    }

    return { scanLimitHit: false, entriesScanned: scanned };
}

function makeExecuteGlob(workspacePath?: string) {
    return async function executeGlob(input: GlobInput): Promise<GlobOutput> {
        const { pattern, path: rawPath, limit } = input;
        const cap = limit ?? DEFAULT_LIMIT;

        validatePattern(pattern);

        const { absolute: searchRoot } = resolveWorkspacePath(
            rawPath,
            workspacePath,
            "glob"
        );

        const matcher = new Bun.Glob(toPosix(pattern));

        const matches: string[] = [];
        let truncated = false;
        let scanLimitHit = false;
        let entriesScanned = 0;

        const iterator = walkFiles(searchRoot, HARD_MAX_ENTRIES_SCANNED);
        while (true) {
            const next = await iterator.next();
            if (next.done) {
                scanLimitHit = next.value?.scanLimitHit ?? false;
                entriesScanned = next.value?.entriesScanned ?? entriesScanned;
                break;
            }
            entriesScanned += 1;
            const relPosix = toPosix(next.value.relative);
            if (!matcher.match(relPosix)) continue;

            if (matches.length >= cap) {
                truncated = true;
                break;
            }
            matches.push(relPosix);
        }

        matches.sort((a, b) => a.localeCompare(b));

        logger.log("[tool:glob]", {
            searchRoot,
            pattern,
            matchCount: matches.length,
            truncated,
            entriesScanned,
            scanLimitHit
        });

        return {
            searchRoot,
            pattern,
            matches,
            matchCount: matches.length,
            truncated,
            entriesScanned,
            scanLimitHit
        };
    };
}

export function createGlobToolDef(
    workspacePath?: string
): ToolDefinition<GlobInput, GlobOutput> {
    return {
        name: "glob",
        description:
            "Find files by glob pattern within the workspace. Patterns are relative to the search root (defaults to the workspace root). Skips node_modules, .git, and other build/cache dirs by default.",
        inputSchema: globInputSchema,
        execute: makeExecuteGlob(workspacePath)
    };
}

export const globToolDef = createGlobToolDef();
