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
import { getRipgrepPath, runRipgrep } from "./ripgrep";
import { readExtraIgnoredSegments } from "./gitignore";

const DEFAULT_HEAD_LIMIT = 100;
const HARD_MAX_HEAD_LIMIT = 1_000;
const MAX_FILE_BYTES = 1_048_576; // 1 MB per file
const MAX_TOTAL_BYTES = 52_428_800; // 50 MB scanned total
const HARD_MAX_ENTRIES_SCANNED = 50_000;
const MAX_LINE_LENGTH = 400;
const MAX_CONTEXT_LINES = 20;

/**
 * Mapping from our `type` parameter to include/exclude globs for the JS
 * fallback. On the ripgrep path we forward `type` directly to `--type`,
 * which understands far more types than this map; the fallback exists so
 * the shape of the tool is identical regardless of whether rg is installed.
 */
const TYPE_GLOB_MAP: Record<string, string[]> = {
    js: ["**/*.js", "**/*.mjs", "**/*.cjs", "**/*.jsx"],
    ts: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"],
    py: ["**/*.py"],
    rust: ["**/*.rs"],
    go: ["**/*.go"],
    java: ["**/*.java"],
    c: ["**/*.c", "**/*.h"],
    cpp: [
        "**/*.cc",
        "**/*.cpp",
        "**/*.cxx",
        "**/*.hh",
        "**/*.hpp"
    ],
    rb: ["**/*.rb"],
    php: ["**/*.php"],
    md: ["**/*.md", "**/*.markdown"],
    json: ["**/*.json"],
    yaml: ["**/*.yaml", "**/*.yml"],
    toml: ["**/*.toml"],
    html: ["**/*.html", "**/*.htm"],
    css: ["**/*.css", "**/*.scss", "**/*.sass", "**/*.less"],
    sh: ["**/*.sh", "**/*.bash", "**/*.zsh"],
    sql: ["**/*.sql"]
};

export const grepInputSchema = z.object({
    pattern: z
        .string()
        .min(1)
        .describe(
            "Regular expression to search for. Ripgrep regex syntax when rg is available (default); JavaScript RegExp syntax on the node fallback. Escape literal metacharacters, e.g. \"foo\\\\.bar\"."
        ),
    path: z
        .string()
        .optional()
        .describe(
            'Optional subdirectory to search in (workspace-relative "/src", relative, or absolute-inside-workspace). Defaults to the workspace root.'
        ),
    include: z
        .string()
        .optional()
        .describe(
            'Optional glob that file paths must match, e.g. "**/*.ts" or "src/**/*.{ts,tsx}".'
        ),
    type: z
        .string()
        .optional()
        .describe(
            "Restrict to a named file type (ripgrep --type). Common values: js, ts, py, rust, go, java, md, json, yaml, html, css. More efficient than `include` for standard file types."
        ),
    typeNot: z
        .string()
        .optional()
        .describe(
            "Exclude a named file type (ripgrep --type-not). Mirrors `type`."
        ),
    outputMode: z
        .enum(["content", "files_with_matches", "count"])
        .optional()
        .describe(
            '"content" (default) returns matching lines. "files_with_matches" returns only file paths. "count" returns per-file match counts. The latter two are cheapest for "where is X?" queries.'
        ),
    caseSensitivity: z
        .enum(["smart", "case-insensitive", "case-sensitive"])
        .optional()
        .describe(
            '"smart" (default): case-sensitive iff the pattern contains uppercase. "case-insensitive": ignore case. "case-sensitive": strict.'
        ),
    caseInsensitive: z
        .boolean()
        .optional()
        .describe(
            "Deprecated: prefer caseSensitivity: 'case-insensitive'. When true, overrides caseSensitivity."
        ),
    multiline: z
        .boolean()
        .optional()
        .describe(
            "When true, patterns can span newlines and '.' matches newlines (ripgrep -U --multiline-dotall; JS 's' + 'm' flags)."
        ),
    contextBefore: z
        .number()
        .int()
        .nonnegative()
        .max(MAX_CONTEXT_LINES)
        .optional()
        .describe(
            `Lines of context before each match (rg -B). Max ${MAX_CONTEXT_LINES}.`
        ),
    contextAfter: z
        .number()
        .int()
        .nonnegative()
        .max(MAX_CONTEXT_LINES)
        .optional()
        .describe(
            `Lines of context after each match (rg -A). Max ${MAX_CONTEXT_LINES}.`
        ),
    context: z
        .number()
        .int()
        .nonnegative()
        .max(MAX_CONTEXT_LINES)
        .optional()
        .describe(
            `Lines of context before AND after each match (rg -C). Max ${MAX_CONTEXT_LINES}. Overridden per side by contextBefore/contextAfter.`
        ),
    headLimit: z
        .number()
        .int()
        .positive()
        .max(HARD_MAX_HEAD_LIMIT)
        .optional()
        .describe(
            `Cap on output rows: match lines (content), files (files_with_matches), or count rows (count). Defaults ${DEFAULT_HEAD_LIMIT}, hard cap ${HARD_MAX_HEAD_LIMIT}.`
        ),
    offset: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe(
            "Skip the first N output rows (after sorting). Use with headLimit for pagination."
        ),
    maxResults: z
        .number()
        .int()
        .positive()
        .max(HARD_MAX_HEAD_LIMIT)
        .optional()
        .describe("Deprecated alias for headLimit.")
});

export type GrepInput = z.infer<typeof grepInputSchema>;

export interface GrepMatch {
    file: string;
    line: number;
    text: string;
    isContext?: boolean;
}

export interface GrepFileCount {
    file: string;
    count: number;
}

export interface GrepOutput {
    searchRoot: string;
    pattern: string;
    outputMode: "content" | "files_with_matches" | "count";
    include?: string;
    type?: string;
    typeNot?: string;
    multiline: boolean;
    engine: "ripgrep" | "walk";
    matches?: GrepMatch[];
    files?: string[];
    counts?: GrepFileCount[];
    matchCount: number;
    filesMatched: number;
    filesScanned?: number;
    bytesScanned?: number;
    truncated: boolean;
    byteLimitHit?: boolean;
    scanLimitHit?: boolean;
    offset: number;
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

function patternHasUppercase(pattern: string): boolean {
    return /[A-Z]/.test(pattern);
}

type CaseSensitivity = "smart" | "case-insensitive" | "case-sensitive";

function resolveCaseSensitivity(input: GrepInput): CaseSensitivity {
    if (input.caseInsensitive === true) return "case-insensitive";
    return input.caseSensitivity ?? "smart";
}

function compileRegex(
    pattern: string,
    input: GrepInput,
    multilineFlags: boolean
): RegExp {
    const cs = resolveCaseSensitivity(input);
    let flags = "";
    if (cs === "case-insensitive") flags += "i";
    else if (cs === "smart" && !patternHasUppercase(pattern)) flags += "i";
    if (multilineFlags) flags += "sm";
    try {
        return new RegExp(pattern, flags);
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

function resolveContextWindow(input: GrepInput): {
    before: number;
    after: number;
} {
    const ctx = input.context ?? 0;
    const before = input.contextBefore ?? ctx;
    const after = input.contextAfter ?? ctx;
    return { before, after };
}

function typeToGlobs(
    type: string | undefined,
    typeNot: string | undefined
): { include: string[]; exclude: string[] } {
    const include: string[] = [];
    const exclude: string[] = [];
    if (type && TYPE_GLOB_MAP[type]) include.push(...TYPE_GLOB_MAP[type]);
    if (typeNot && TYPE_GLOB_MAP[typeNot])
        exclude.push(...TYPE_GLOB_MAP[typeNot]);
    return { include, exclude };
}

function makeFileFilter(
    include: string | undefined,
    typeInclude: string[],
    typeExclude: string[]
): (relPosix: string) => boolean {
    const includeMatcher = include ? new Bun.Glob(toPosix(include)) : null;
    const typeIncludeMatchers = typeInclude.map(
        (g) => new Bun.Glob(toPosix(g))
    );
    const typeExcludeMatchers = typeExclude.map(
        (g) => new Bun.Glob(toPosix(g))
    );
    return (p: string) => {
        if (includeMatcher && !includeMatcher.match(p)) return false;
        if (
            typeIncludeMatchers.length > 0 &&
            !typeIncludeMatchers.some((m) => m.match(p))
        )
            return false;
        if (typeExcludeMatchers.some((m) => m.match(p))) return false;
        return true;
    };
}

// ─── ripgrep path ────────────────────────────────────────────────────────────

function buildRipgrepArgs(
    input: GrepInput,
    opts: {
        outputMode: "content" | "files_with_matches" | "count";
        before: number;
        after: number;
    }
): string[] {
    const args: string[] = ["--no-messages", "--hidden"];

    for (const seg of IGNORED_DIR_SEGMENTS) {
        args.push("--glob", `!**/${seg}/**`);
    }

    const cs = resolveCaseSensitivity(input);
    if (cs === "case-insensitive") args.push("-i");
    else if (cs === "smart") args.push("-S");
    // case-sensitive is rg's default when -S / -i absent.

    if (input.multiline) args.push("-U", "--multiline-dotall");
    if (input.type) args.push("--type", input.type);
    if (input.typeNot) args.push("--type-not", input.typeNot);
    if (input.include) args.push("--glob", input.include);

    args.push("--max-filesize", String(MAX_FILE_BYTES));

    if (opts.outputMode === "files_with_matches") {
        args.push("-l", "--sort", "path");
    } else if (opts.outputMode === "count") {
        args.push("-c", "--sort", "path");
    } else {
        args.push("--json");
        if (opts.before > 0) args.push("-B", String(opts.before));
        if (opts.after > 0) args.push("-A", String(opts.after));
    }

    args.push("-e", input.pattern);
    args.push("--", ".");
    return args;
}

interface RgJsonField {
    text?: string;
    bytes?: string;
}

interface RgJsonEvent {
    type: "begin" | "end" | "match" | "context" | "summary";
    data: {
        path?: RgJsonField;
        lines?: RgJsonField;
        line_number?: number;
    };
}

function rgTextFromField(field: RgJsonField | undefined): string {
    if (!field) return "";
    if (typeof field.text === "string") return field.text;
    if (typeof field.bytes === "string") {
        try {
            return Buffer.from(field.bytes, "base64").toString("utf8");
        } catch {
            return "";
        }
    }
    return "";
}

function stripTrailingNewline(s: string): string {
    if (s.endsWith("\r\n")) return s.slice(0, -2);
    if (s.endsWith("\n") || s.endsWith("\r")) return s.slice(0, -1);
    return s;
}

/**
 * Parse rg --json stdout into a list of rows while applying pagination on
 * MATCH events only. Context events are retained when they sit within
 * contextBefore/contextAfter lines of at least one kept match in the
 * same file.
 */
function parseRgJson(
    stdout: string,
    headLimit: number,
    offset: number,
    contextBefore: number,
    contextAfter: number
): {
    matches: GrepMatch[];
    filesMatched: Set<string>;
    totalMatchEvents: number;
    truncated: boolean;
} {
    interface RawEv {
        kind: "match" | "context";
        file: string;
        line: number;
        text: string;
    }
    const raw: RawEv[] = [];
    const filesMatched = new Set<string>();
    let matchCounter = 0;
    let produced = 0;
    let truncated = false;

    for (const rawLine of stdout.split(/\r?\n/)) {
        if (!rawLine) continue;
        let evt: RgJsonEvent;
        try {
            evt = JSON.parse(rawLine) as RgJsonEvent;
        } catch {
            continue;
        }
        if (evt.type !== "match" && evt.type !== "context") continue;
        const data = evt.data;
        const file = toPosix(rgTextFromField(data.path));
        const line =
            typeof data.line_number === "number" ? data.line_number : 0;
        const text = truncateLine(
            stripTrailingNewline(rgTextFromField(data.lines))
        );

        if (evt.type === "match") {
            matchCounter += 1;
            if (matchCounter <= offset) continue;
            if (produced >= headLimit) {
                truncated = true;
                continue;
            }
            produced += 1;
            filesMatched.add(file);
            raw.push({ kind: "match", file, line, text });
        } else {
            raw.push({ kind: "context", file, line, text });
        }
    }

    if (matchCounter > offset + produced) truncated = true;

    const window = Math.max(contextBefore, contextAfter);
    const keptMatchLinesByFile = new Map<string, number[]>();
    for (const ev of raw) {
        if (ev.kind !== "match") continue;
        const arr = keptMatchLinesByFile.get(ev.file) ?? [];
        arr.push(ev.line);
        keptMatchLinesByFile.set(ev.file, arr);
    }

    const kept: GrepMatch[] = [];
    for (const ev of raw) {
        if (ev.kind === "match") {
            kept.push({ file: ev.file, line: ev.line, text: ev.text });
            continue;
        }
        if (window === 0) continue;
        const lines = keptMatchLinesByFile.get(ev.file);
        if (!lines) continue;
        let near = false;
        for (const m of lines) {
            const delta = ev.line - m;
            if (delta < 0 ? -delta <= contextBefore : delta <= contextAfter) {
                near = true;
                break;
            }
        }
        if (near)
            kept.push({
                file: ev.file,
                line: ev.line,
                text: ev.text,
                isContext: true
            });
    }

    kept.sort((a, b) => {
        if (a.file !== b.file) return a.file.localeCompare(b.file);
        return a.line - b.line;
    });

    return {
        matches: kept,
        filesMatched,
        totalMatchEvents: matchCounter,
        truncated
    };
}

async function grepViaRipgrep(
    searchRoot: string,
    input: GrepInput,
    opts: {
        outputMode: "content" | "files_with_matches" | "count";
        headLimit: number;
        offset: number;
        before: number;
        after: number;
    }
): Promise<GrepOutput | null> {
    const args = buildRipgrepArgs(input, {
        outputMode: opts.outputMode,
        before: opts.before,
        after: opts.after
    });

    const { stdout, stderr, exitCode, timedOut, stdoutTruncated } =
        await runRipgrep(args, searchRoot);

    if (timedOut) {
        logger.log("[tool:grep] rg timed out; falling back to walk");
        return null;
    }
    if (exitCode === 2) {
        const msg = stderr.slice(0, 500);
        logger.log("[tool:grep] rg error exit", { exitCode, stderr: msg });
        throw new Error(`ripgrep error: ${msg || "exit code 2"}`);
    }

    const base = {
        searchRoot,
        pattern: input.pattern,
        outputMode: opts.outputMode,
        include: input.include,
        type: input.type,
        typeNot: input.typeNot,
        multiline: !!input.multiline,
        engine: "ripgrep" as const,
        offset: opts.offset
    };

    if (opts.outputMode === "files_with_matches") {
        const files = stdout
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter(Boolean)
            .map(toPosix);
        const paged = files.slice(opts.offset, opts.offset + opts.headLimit);
        const truncated =
            stdoutTruncated || opts.offset + paged.length < files.length;
        return {
            ...base,
            files: paged,
            matchCount: paged.length,
            filesMatched: paged.length,
            truncated
        };
    }

    if (opts.outputMode === "count") {
        const counts: GrepFileCount[] = [];
        for (const l of stdout.split(/\r?\n/)) {
            const trimmed = l.trim();
            if (!trimmed) continue;
            const idx = trimmed.lastIndexOf(":");
            if (idx < 0) continue;
            const file = toPosix(trimmed.slice(0, idx));
            const n = Number(trimmed.slice(idx + 1));
            if (!Number.isFinite(n)) continue;
            counts.push({ file, count: n });
        }
        const paged = counts.slice(opts.offset, opts.offset + opts.headLimit);
        const truncated =
            stdoutTruncated || opts.offset + paged.length < counts.length;
        const totalMatches = paged.reduce((a, b) => a + b.count, 0);
        return {
            ...base,
            counts: paged,
            matchCount: totalMatches,
            filesMatched: paged.length,
            truncated
        };
    }

    const parsed = parseRgJson(
        stdout,
        opts.headLimit,
        opts.offset,
        opts.before,
        opts.after
    );
    return {
        ...base,
        matches: parsed.matches,
        matchCount: parsed.matches.filter((m) => !m.isContext).length,
        filesMatched: parsed.filesMatched.size,
        truncated: stdoutTruncated || parsed.truncated
    };
}

// ─── JS fallback walker ──────────────────────────────────────────────────────

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

interface WalkScanStats {
    filesScanned: number;
    bytesScanned: number;
    byteLimitHit: boolean;
    scanLimitHit: boolean;
    entriesScanned: number;
}

interface WalkAccumulator {
    rawMatches: GrepMatch[]; // content mode, match lines only (isContext=false)
    contextRows: GrepMatch[]; // content mode, isContext=true rows
    filesToMatchCount: Map<string, number>;
    matchCounter: number;
    produced: number;
    truncated: boolean;
}

async function walkAndSearchPerLine(
    searchRoot: string,
    input: GrepInput,
    filter: (p: string) => boolean,
    opts: {
        outputMode: "content" | "files_with_matches" | "count";
        headLimit: number;
        offset: number;
        before: number;
        after: number;
    },
    ignoredDirs: ReadonlySet<string>
): Promise<WalkAccumulator & WalkScanStats> {
    const regex = compileRegex(input.pattern, input, false);

    const acc: WalkAccumulator = {
        rawMatches: [],
        contextRows: [],
        filesToMatchCount: new Map(),
        matchCounter: 0,
        produced: 0,
        truncated: false
    };

    let filesScanned = 0;
    let bytesScanned = 0;
    let byteLimitHit = false;
    let scanLimitHit = false;
    let entriesScanned = 0;

    outer: {
        const iter = walkFiles(searchRoot, HARD_MAX_ENTRIES_SCANNED, ignoredDirs);
        while (true) {
            const next = await iter.next();
            if (next.done) {
                scanLimitHit = next.value?.scanLimitHit ?? false;
                entriesScanned = next.value?.entriesScanned ?? entriesScanned;
                break;
            }
            entriesScanned += 1;
            const { absolute, relative: rel } = next.value;
            const relPosix = toPosix(rel);
            if (!filter(relPosix)) continue;

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

            const keptLineIdxInThisFile: number[] = [];

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i]!;
                if (!regex.test(line)) continue;

                if (opts.outputMode === "files_with_matches") {
                    acc.filesToMatchCount.set(relPosix, 1);
                    acc.matchCounter += 1;
                    break; // one is enough for this file
                }

                if (opts.outputMode === "count") {
                    acc.filesToMatchCount.set(
                        relPosix,
                        (acc.filesToMatchCount.get(relPosix) ?? 0) + 1
                    );
                    acc.matchCounter += 1;
                    continue;
                }

                // content mode
                acc.matchCounter += 1;
                if (acc.matchCounter <= opts.offset) continue;
                if (acc.produced >= opts.headLimit) {
                    acc.truncated = true;
                    break outer;
                }
                acc.produced += 1;
                keptLineIdxInThisFile.push(i);
                acc.rawMatches.push({
                    file: relPosix,
                    line: i + 1,
                    text: truncateLine(line)
                });
                acc.filesToMatchCount.set(
                    relPosix,
                    (acc.filesToMatchCount.get(relPosix) ?? 0) + 1
                );
            }

            if (
                opts.outputMode === "content" &&
                (opts.before > 0 || opts.after > 0) &&
                keptLineIdxInThisFile.length > 0
            ) {
                const matchLineSet = new Set(keptLineIdxInThisFile);
                const contextIdxs = new Set<number>();
                for (const mi of keptLineIdxInThisFile) {
                    const lo = Math.max(0, mi - opts.before);
                    const hi = Math.min(lines.length - 1, mi + opts.after);
                    for (let k = lo; k <= hi; k++) {
                        if (matchLineSet.has(k)) continue;
                        contextIdxs.add(k);
                    }
                }
                for (const k of contextIdxs) {
                    acc.contextRows.push({
                        file: relPosix,
                        line: k + 1,
                        text: truncateLine(lines[k] ?? ""),
                        isContext: true
                    });
                }
            }
        }
    }

    return {
        ...acc,
        filesScanned,
        bytesScanned,
        byteLimitHit,
        scanLimitHit,
        entriesScanned
    };
}

async function walkAndSearchMultiline(
    searchRoot: string,
    input: GrepInput,
    filter: (p: string) => boolean,
    opts: {
        outputMode: "content" | "files_with_matches" | "count";
        headLimit: number;
        offset: number;
        before: number;
        after: number;
    },
    ignoredDirs: ReadonlySet<string>
): Promise<WalkAccumulator & WalkScanStats> {
    const cs = resolveCaseSensitivity(input);
    let flags = "gsm";
    if (cs === "case-insensitive") flags += "i";
    else if (cs === "smart" && !patternHasUppercase(input.pattern)) flags += "i";
    let regex: RegExp;
    try {
        regex = new RegExp(input.pattern, flags);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Invalid regex: ${message}`);
    }

    const acc: WalkAccumulator = {
        rawMatches: [],
        contextRows: [],
        filesToMatchCount: new Map(),
        matchCounter: 0,
        produced: 0,
        truncated: false
    };

    let filesScanned = 0;
    let bytesScanned = 0;
    let byteLimitHit = false;
    let scanLimitHit = false;
    let entriesScanned = 0;

    outer: {
        const iter = walkFiles(searchRoot, HARD_MAX_ENTRIES_SCANNED, ignoredDirs);
        while (true) {
            const next = await iter.next();
            if (next.done) {
                scanLimitHit = next.value?.scanLimitHit ?? false;
                entriesScanned = next.value?.entriesScanned ?? entriesScanned;
                break;
            }
            entriesScanned += 1;
            const { absolute, relative: rel } = next.value;
            const relPosix = toPosix(rel);
            if (!filter(relPosix)) continue;

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

            // Precompute line-start offsets so we can map absolute positions
            // back to 0-based line numbers via binary search.
            const lineStarts: number[] = [0];
            for (let i = 0; i < content.length; i++) {
                if (content.charCodeAt(i) === 0x0a) lineStarts.push(i + 1);
            }
            const posToLine = (pos: number): number => {
                let lo = 0;
                let hi = lineStarts.length - 1;
                while (lo < hi) {
                    const mid = (lo + hi + 1) >> 1;
                    if ((lineStarts[mid] ?? 0) <= pos) lo = mid;
                    else hi = mid - 1;
                }
                return lo;
            };
            const lines = content.split(/\r\n|\r|\n/);

            regex.lastIndex = 0;
            const keptLineIdxInThisFile: number[] = [];
            let m: RegExpExecArray | null;

            while ((m = regex.exec(content)) !== null) {
                const lineIdx = posToLine(m.index);

                if (opts.outputMode === "files_with_matches") {
                    acc.filesToMatchCount.set(relPosix, 1);
                    acc.matchCounter += 1;
                    break;
                }

                if (opts.outputMode === "count") {
                    acc.filesToMatchCount.set(
                        relPosix,
                        (acc.filesToMatchCount.get(relPosix) ?? 0) + 1
                    );
                    acc.matchCounter += 1;
                    if (m.index === regex.lastIndex) regex.lastIndex++;
                    continue;
                }

                // content mode
                acc.matchCounter += 1;
                if (acc.matchCounter <= opts.offset) {
                    if (m.index === regex.lastIndex) regex.lastIndex++;
                    continue;
                }
                if (acc.produced >= opts.headLimit) {
                    acc.truncated = true;
                    break outer;
                }
                acc.produced += 1;
                keptLineIdxInThisFile.push(lineIdx);

                const firstNewline = m[0].indexOf("\n");
                const previewSource =
                    firstNewline >= 0 ? m[0].slice(0, firstNewline) : m[0];
                const representative = lines[lineIdx] ?? previewSource;

                acc.rawMatches.push({
                    file: relPosix,
                    line: lineIdx + 1,
                    text: truncateLine(representative)
                });
                acc.filesToMatchCount.set(
                    relPosix,
                    (acc.filesToMatchCount.get(relPosix) ?? 0) + 1
                );

                if (m.index === regex.lastIndex) regex.lastIndex++;
            }

            if (
                opts.outputMode === "content" &&
                (opts.before > 0 || opts.after > 0) &&
                keptLineIdxInThisFile.length > 0
            ) {
                const matchLineSet = new Set(keptLineIdxInThisFile);
                const contextIdxs = new Set<number>();
                for (const mi of keptLineIdxInThisFile) {
                    const lo = Math.max(0, mi - opts.before);
                    const hi = Math.min(lines.length - 1, mi + opts.after);
                    for (let k = lo; k <= hi; k++) {
                        if (matchLineSet.has(k)) continue;
                        contextIdxs.add(k);
                    }
                }
                for (const k of contextIdxs) {
                    acc.contextRows.push({
                        file: relPosix,
                        line: k + 1,
                        text: truncateLine(lines[k] ?? ""),
                        isContext: true
                    });
                }
            }
        }
    }

    return {
        ...acc,
        filesScanned,
        bytesScanned,
        byteLimitHit,
        scanLimitHit,
        entriesScanned
    };
}

function finalizeWalkResult(
    searchRoot: string,
    input: GrepInput,
    walk: WalkAccumulator & WalkScanStats,
    opts: {
        outputMode: "content" | "files_with_matches" | "count";
        headLimit: number;
        offset: number;
    },
    multiline: boolean
): GrepOutput {
    const base = {
        searchRoot,
        pattern: input.pattern,
        outputMode: opts.outputMode,
        include: input.include,
        type: input.type,
        typeNot: input.typeNot,
        multiline,
        engine: "walk" as const,
        offset: opts.offset,
        filesScanned: walk.filesScanned,
        bytesScanned: walk.bytesScanned,
        byteLimitHit: walk.byteLimitHit,
        scanLimitHit: walk.scanLimitHit
    };

    if (opts.outputMode === "content") {
        const combined: GrepMatch[] = [...walk.rawMatches, ...walk.contextRows];
        combined.sort((a, b) => {
            if (a.file !== b.file) return a.file.localeCompare(b.file);
            if (a.line !== b.line) return a.line - b.line;
            // match before context on the same line (shouldn't collide)
            return (a.isContext ? 1 : 0) - (b.isContext ? 1 : 0);
        });
        return {
            ...base,
            matches: combined,
            matchCount: walk.rawMatches.length,
            filesMatched: walk.filesToMatchCount.size,
            truncated: walk.truncated
        };
    }

    if (opts.outputMode === "files_with_matches") {
        const files = [...walk.filesToMatchCount.keys()].sort((a, b) =>
            a.localeCompare(b)
        );
        const paged = files.slice(opts.offset, opts.offset + opts.headLimit);
        const truncated = opts.offset + paged.length < files.length;
        return {
            ...base,
            files: paged,
            matchCount: paged.length,
            filesMatched: paged.length,
            truncated
        };
    }

    // count
    const countEntries: GrepFileCount[] = [...walk.filesToMatchCount.entries()]
        .map(([file, count]) => ({ file, count }))
        .sort((a, b) => a.file.localeCompare(b.file));
    const paged = countEntries.slice(opts.offset, opts.offset + opts.headLimit);
    const truncated = opts.offset + paged.length < countEntries.length;
    return {
        ...base,
        counts: paged,
        matchCount: paged.reduce((a, b) => a + b.count, 0),
        filesMatched: paged.length,
        truncated
    };
}

// ─── entry point ─────────────────────────────────────────────────────────────

function makeExecuteGrep(workspacePath?: string) {
    return async function executeGrep(input: GrepInput): Promise<GrepOutput> {
        const outputMode = input.outputMode ?? "content";
        const headLimit =
            input.headLimit ?? input.maxResults ?? DEFAULT_HEAD_LIMIT;
        const offset = input.offset ?? 0;
        const { before, after } = resolveContextWindow(input);

        if (input.include) validateIncludePattern(input.include);

        const { absolute: searchRoot } = resolveWorkspacePath(
            input.path,
            workspacePath,
            "grep"
        );

        // Ripgrep path (preferred).
        if (getRipgrepPath()) {
            try {
                const rgOut = await grepViaRipgrep(searchRoot, input, {
                    outputMode,
                    headLimit,
                    offset,
                    before,
                    after
                });
                if (rgOut) {
                    logger.log("[tool:grep] via rg", {
                        searchRoot,
                        pattern: input.pattern,
                        outputMode,
                        matchCount: rgOut.matchCount,
                        filesMatched: rgOut.filesMatched,
                        truncated: rgOut.truncated
                    });
                    return rgOut;
                }
            } catch (error) {
                // Only throw through for the "ripgrep error" case; timeouts and
                // missing-rg already returned null and we fall through.
                if (
                    error instanceof Error &&
                    error.message.startsWith("ripgrep error:")
                ) {
                    throw error;
                }
                logger.log("[tool:grep] rg threw; falling back", {
                    error:
                        error instanceof Error ? error.message : String(error)
                });
            }
        }

        // Fallback: pure-node walker.
        const { include: typeInclude, exclude: typeExclude } = typeToGlobs(
            input.type,
            input.typeNot
        );
        const filter = makeFileFilter(input.include, typeInclude, typeExclude);

        const extraIgnored = await readExtraIgnoredSegments(searchRoot);
        const ignoredDirs = new Set<string>([
            ...IGNORED_DIR_SEGMENTS,
            ...extraIgnored
        ]);

        const walk = input.multiline
            ? await walkAndSearchMultiline(
                  searchRoot,
                  input,
                  filter,
                  { outputMode, headLimit, offset, before, after },
                  ignoredDirs
              )
            : await walkAndSearchPerLine(
                  searchRoot,
                  input,
                  filter,
                  { outputMode, headLimit, offset, before, after },
                  ignoredDirs
              );

        const result = finalizeWalkResult(
            searchRoot,
            input,
            walk,
            { outputMode, headLimit, offset },
            !!input.multiline
        );

        logger.log("[tool:grep] via walk", {
            searchRoot,
            pattern: input.pattern,
            outputMode,
            multiline: !!input.multiline,
            matchCount: result.matchCount,
            filesMatched: result.filesMatched,
            filesScanned: walk.filesScanned,
            bytesScanned: walk.bytesScanned,
            truncated: result.truncated,
            byteLimitHit: walk.byteLimitHit,
            scanLimitHit: walk.scanLimitHit
        });

        return result;
    };
}

export function createGrepToolDef(
    workspacePath?: string
): ToolDefinition<GrepInput, GrepOutput> {
    return {
        name: "grep",
        description:
            "Search file contents with a regex. Uses ripgrep when available (multiline, smart-case, .gitignore, --type filters); falls back to a node walk that skips common build/cache dirs. Output modes: content (default), files_with_matches, count. Supports context lines (contextBefore/contextAfter/context), type/typeNot filters, pagination via headLimit/offset. Binary files, empty files, and files larger than 1MB are skipped.",
        inputSchema: grepInputSchema,
        execute: makeExecuteGrep(workspacePath)
    };
}

export const grepToolDef = createGrepToolDef();
