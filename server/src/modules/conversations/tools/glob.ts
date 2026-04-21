import { readdir, stat } from "node:fs/promises";
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
import { getRipgrepPath, runRipgrep } from "./ripgrep";
import { readExtraIgnoredSegments } from "./gitignore";

const DEFAULT_HEAD_LIMIT = 100;
const HARD_MAX_HEAD_LIMIT = 1_000;
const HARD_MAX_ENTRIES_SCANNED = 50_000;
// Cap how many files we stat for mtime sorting. Scanning 100k stats just
// to throw most of them away is wasteful; beyond this cap we fall back to
// alphabetical ordering for the tail of the result set.
const MTIME_STAT_CAP = 10_000;

export const globInputSchema = z.object({
    pattern: z
        .string()
        .min(1)
        .describe(
            'Glob pattern relative to the search root, e.g. "**/*.ts" or "src/**/*.{ts,tsx}". Standard glob syntax (*, **, ?, {a,b}, [abc]).'
        ),
    path: z
        .string()
        .optional()
        .describe(
            'Optional subdirectory to search in, resolved against the workspace. "/src" is workspace-relative; relative paths resolve against the workspace; absolute paths must live inside the workspace. Defaults to the workspace root.'
        ),
    sortBy: z
        .enum(["mtime", "name"])
        .optional()
        .describe(
            'Sort order. "mtime" (default) lists the most recently modified files first. "name" sorts alphabetically.'
        ),
    headLimit: z
        .number()
        .int()
        .positive()
        .max(HARD_MAX_HEAD_LIMIT)
        .optional()
        .describe(
            `Maximum number of matches to return. Defaults to ${DEFAULT_HEAD_LIMIT}, hard cap ${HARD_MAX_HEAD_LIMIT}.`
        ),
    offset: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe(
            "Skip the first N matches (after sorting). Combine with headLimit for pagination."
        ),
    limit: z
        .number()
        .int()
        .positive()
        .max(HARD_MAX_HEAD_LIMIT)
        .optional()
        .describe("Deprecated alias for headLimit.")
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
    sortBy: "mtime" | "name";
    offset: number;
    engine: "ripgrep" | "walk";
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

/**
 * Split a glob into its literal directory prefix and the remainder. For
 * "src/components/**\/*.tsx" we return { anchor: "src/components", rest:
 * "**\/*.tsx" }. This lets the walker start deeper in the tree instead
 * of touring the whole workspace just to filter out most of it.
 */
function extractLiteralAnchor(pattern: string): {
    anchor: string;
    rest: string;
} {
    const normalized = toPosix(pattern);
    const metaIdx = normalized.search(/[*?\[\]{}]/);
    if (metaIdx <= 0) return { anchor: "", rest: normalized };
    const prefix = normalized.slice(0, metaIdx);
    const lastSlash = prefix.lastIndexOf("/");
    if (lastSlash < 0) return { anchor: "", rest: normalized };
    return {
        anchor: prefix.slice(0, lastSlash),
        rest: normalized.slice(lastSlash + 1)
    };
}

async function* walkFiles(
    root: string,
    maxEntries: number,
    ignoredDirs: ReadonlySet<string>
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
            if (entry.isSymbolicLink()) continue;

            if (entry.isDirectory()) {
                if (ignoredDirs.has(entry.name)) continue;
                stack.push(abs);
                continue;
            }

            if (!entry.isFile()) continue;
            yield { absolute: abs, relative: relative(root, abs) };
        }
    }

    return { scanLimitHit: false, entriesScanned: scanned };
}

interface FileStat {
    relPosix: string;
    mtimeMs: number;
}

async function statForSort(
    searchRoot: string,
    relList: string[],
    limit: number
): Promise<FileStat[]> {
    const slice = relList.slice(0, limit);
    const results = await Promise.all(
        slice.map(async (rel) => {
            try {
                const s = await stat(join(searchRoot, rel));
                return { relPosix: rel, mtimeMs: s.mtimeMs } as FileStat;
            } catch {
                return null;
            }
        })
    );
    return results.filter((r): r is FileStat => r !== null);
}

function sortByMode(
    relList: string[],
    searchRoot: string,
    sortBy: "mtime" | "name"
): Promise<string[]> {
    if (sortBy === "name") {
        return Promise.resolve(
            [...relList].sort((a, b) => a.localeCompare(b))
        );
    }
    return (async () => {
        const stats = await statForSort(searchRoot, relList, MTIME_STAT_CAP);
        stats.sort((a, b) => b.mtimeMs - a.mtimeMs);
        const head = stats.map((s) => s.relPosix);
        if (relList.length <= MTIME_STAT_CAP) return head;
        const seen = new Set(head);
        const tail = relList
            .filter((r) => !seen.has(r))
            .sort((a, b) => a.localeCompare(b));
        return head.concat(tail);
    })();
}

async function globViaRipgrep(
    searchRoot: string,
    pattern: string,
    sortBy: "mtime" | "name",
    offset: number,
    headLimit: number
): Promise<
    | {
          matches: string[];
          truncated: boolean;
          totalCandidates: number;
      }
    | null
> {
    if (!getRipgrepPath()) return null;

    const args: string[] = ["--files", "--hidden", "--no-messages"];
    // Defensively exclude our built-in ignore list even if .gitignore doesn't.
    for (const seg of IGNORED_DIR_SEGMENTS) {
        args.push("--glob", `!**/${seg}/**`);
    }
    args.push("--glob", pattern);
    args.push("--", ".");

    const { stdout, stderr, exitCode, timedOut, stdoutTruncated } =
        await runRipgrep(args, searchRoot);

    if (timedOut) {
        logger.log("[tool:glob] rg timed out; falling back to walk");
        return null;
    }
    // rg --files: exit 0 = at least one file, 1 = no files, 2 = error.
    if (exitCode !== 0 && exitCode !== 1) {
        logger.log("[tool:glob] rg non-zero exit; falling back", {
            exitCode,
            stderr: stderr.slice(0, 500)
        });
        return null;
    }

    const relList = stdout
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
        .map(toPosix);

    const sorted = await sortByMode(relList, searchRoot, sortBy);
    const paged = sorted.slice(offset, offset + headLimit);
    const truncated =
        stdoutTruncated || offset + paged.length < sorted.length;

    return {
        matches: paged,
        truncated,
        totalCandidates: sorted.length
    };
}

function makeExecuteGlob(workspacePath?: string) {
    return async function executeGlob(input: GlobInput): Promise<GlobOutput> {
        const {
            pattern,
            path: rawPath,
            sortBy: rawSortBy,
            headLimit: rawHeadLimit,
            offset: rawOffset,
            limit: legacyLimit
        } = input;

        const headLimit = rawHeadLimit ?? legacyLimit ?? DEFAULT_HEAD_LIMIT;
        const offset = rawOffset ?? 0;
        const sortBy = rawSortBy ?? "mtime";

        validatePattern(pattern);

        const { absolute: searchRoot } = resolveWorkspacePath(
            rawPath,
            workspacePath,
            "glob"
        );

        // Ripgrep path: fastest, honors .gitignore natively.
        try {
            const rgResult = await globViaRipgrep(
                searchRoot,
                toPosix(pattern),
                sortBy,
                offset,
                headLimit
            );
            if (rgResult) {
                logger.log("[tool:glob] via rg", {
                    searchRoot,
                    pattern,
                    matchCount: rgResult.matches.length,
                    total: rgResult.totalCandidates,
                    truncated: rgResult.truncated,
                    sortBy,
                    offset
                });
                return {
                    searchRoot,
                    pattern,
                    matches: rgResult.matches,
                    matchCount: rgResult.matches.length,
                    truncated: rgResult.truncated,
                    entriesScanned: rgResult.totalCandidates,
                    scanLimitHit: false,
                    sortBy,
                    offset,
                    engine: "ripgrep"
                };
            }
        } catch (error) {
            logger.log("[tool:glob] rg threw; falling back", {
                error: error instanceof Error ? error.message : String(error)
            });
        }

        // JS fallback with literal-prefix anchoring + .gitignore-derived extras.
        const { anchor, rest } = extractLiteralAnchor(toPosix(pattern));
        const walkRoot = anchor ? join(searchRoot, anchor) : searchRoot;
        const relativePattern = anchor ? rest : toPosix(pattern);
        const matcher = new Bun.Glob(relativePattern);

        const extraIgnored = await readExtraIgnoredSegments(searchRoot);
        const ignoredDirs = new Set<string>([
            ...IGNORED_DIR_SEGMENTS,
            ...extraIgnored
        ]);

        const candidates: string[] = [];
        let scanLimitHit = false;
        let entriesScanned = 0;

        try {
            const iter = walkFiles(walkRoot, HARD_MAX_ENTRIES_SCANNED, ignoredDirs);
            while (true) {
                const next = await iter.next();
                if (next.done) {
                    scanLimitHit = next.value?.scanLimitHit ?? false;
                    entriesScanned = next.value?.entriesScanned ?? entriesScanned;
                    break;
                }
                entriesScanned += 1;
                const relUnderWalk = toPosix(next.value.relative);
                if (!matcher.match(relUnderWalk)) continue;
                const relFromRoot = anchor
                    ? toPosix(relative(searchRoot, next.value.absolute))
                    : relUnderWalk;
                candidates.push(relFromRoot);
            }
        } catch (err) {
            logger.log("[tool:glob] walk error", {
                err: err instanceof Error ? err.message : String(err)
            });
        }

        const sorted = await sortByMode(candidates, searchRoot, sortBy);
        const matches = sorted.slice(offset, offset + headLimit);
        const truncated = offset + matches.length < sorted.length;

        logger.log("[tool:glob] via walk", {
            searchRoot,
            pattern,
            matchCount: matches.length,
            total: sorted.length,
            truncated,
            entriesScanned,
            scanLimitHit,
            sortBy,
            offset
        });

        return {
            searchRoot,
            pattern,
            matches,
            matchCount: matches.length,
            truncated,
            entriesScanned,
            scanLimitHit,
            sortBy,
            offset,
            engine: "walk"
        };
    };
}

export function createGlobToolDef(
    workspacePath?: string
): ToolDefinition<GlobInput, GlobOutput> {
    return {
        name: "glob",
        description:
            "Find files by glob pattern within the workspace, sorted by modification time by default (most recent first). Uses ripgrep when available for speed and .gitignore awareness; falls back to a node walk that anchors to the pattern's literal prefix and skips common build/cache dirs. Supports pagination via headLimit/offset.",
        inputSchema: globInputSchema,
        execute: makeExecuteGlob(workspacePath)
    };
}

export const globToolDef = createGlobToolDef();
