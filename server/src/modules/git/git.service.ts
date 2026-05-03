import { readFile, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { getWorkspace } from "../workspaces/workspaces.service";
import type {
    GitBranchInfo,
    GitChangeKind,
    GitCommitResult,
    GitFileChange,
    GitFileDiff,
    GitStatus
} from "./git.types";

// ─── Process plumbing ─────────────────────────────────────────────────────────
//
// We shell out to the system `git` rather than embedding libgit2. Reasons:
//  - parity with whatever the user has configured (hooks, identity, gpg)
//  - keeps the sidecar binary small
//  - `git` is already a hard dependency of any developer environment

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024; // 8 MB stdout cap per invocation
const MAX_DIFF_FILE_BYTES = 1_048_576; // 1 MB per side; mirrors filetree reader

interface GitRun {
    stdout: string;
    stderr: string;
    exitCode: number;
    timedOut: boolean;
}

let cachedGitPath: string | null | undefined = undefined;

function getGitPath(): string | null {
    if (cachedGitPath !== undefined) return cachedGitPath;
    try {
        const which = (
            Bun as unknown as { which?: (bin: string) => string | null }
        ).which;
        const found = which ? which("git") : null;
        cachedGitPath =
            typeof found === "string" && found.length > 0 ? found : null;
    } catch {
        cachedGitPath = null;
    }
    return cachedGitPath;
}

async function readStream(
    stream: ReadableStream<Uint8Array>,
    maxBytes: number
): Promise<string> {
    const decoder = new TextDecoder();
    const reader = stream.getReader();
    let text = "";
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            text += decoder.decode(value, { stream: true });
            if (text.length > maxBytes) break;
        }
        text += decoder.decode();
    } finally {
        try {
            reader.releaseLock();
        } catch {
            /* noop */
        }
    }
    return text;
}

async function runGit(
    cwd: string,
    args: string[],
    options: { timeoutMs?: number; stdin?: string } = {}
): Promise<GitRun> {
    const gitPath = getGitPath();
    if (!gitPath) {
        throw new Error(
            "git is not available on PATH. Install git to enable the Git panel."
        );
    }

    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const proc = Bun.spawn([gitPath, ...args], {
        cwd,
        stdin: options.stdin ? "pipe" : "ignore",
        stdout: "pipe",
        stderr: "pipe",
        env: {
            ...process.env,
            // Force English output so our parsers don't break under locales
            // like de_DE that translate `Untracked files:` etc.
            LANG: "C",
            LC_ALL: "C",
            // Keep git non-interactive — never spawn an editor or pager.
            GIT_TERMINAL_PROMPT: "0",
            GIT_PAGER: "cat"
        }
    });

    if (options.stdin && proc.stdin) {
        const writer = proc.stdin as unknown as {
            write?: (data: string) => void;
            end?: () => void;
        };
        if (typeof writer.write === "function") {
            writer.write(options.stdin);
        }
        if (typeof writer.end === "function") {
            writer.end();
        }
    }

    let timedOut = false;
    const timer = setTimeout(() => {
        timedOut = true;
        try {
            proc.kill();
        } catch {
            /* noop */
        }
    }, timeoutMs);

    const [stdout, stderr] = await Promise.all([
        readStream(proc.stdout as ReadableStream<Uint8Array>, MAX_OUTPUT_BYTES),
        readStream(proc.stderr as ReadableStream<Uint8Array>, MAX_OUTPUT_BYTES)
    ]);

    const exitCode = await proc.exited;
    clearTimeout(timer);

    return { stdout, stderr, exitCode, timedOut };
}

// ─── Path helpers ─────────────────────────────────────────────────────────────

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

function resolveWorkspacePath(workspaceId: string, requestedPath: string) {
    const workspace = getWorkspace(workspaceId);
    const root = resolve(workspace.path);
    const trimmed = requestedPath.trim().replace(/^[/\\]+/, "");
    if (!trimmed) throw new Error("path is required");
    const target = resolve(root, trimmed);
    if (!isInside(root, target)) {
        throw new Error(`Path is outside the workspace: ${requestedPath}`);
    }
    return { workspace, root, target, posix: toPosix(relative(root, target)) };
}

// ─── Repo detection / branch info ────────────────────────────────────────────

async function detectRepo(cwd: string): Promise<boolean> {
    const run = await runGit(cwd, ["rev-parse", "--is-inside-work-tree"], {
        timeoutMs: 5_000
    });
    if (run.timedOut) return false;
    return run.exitCode === 0 && run.stdout.trim() === "true";
}

async function readBranchInfo(cwd: string): Promise<GitBranchInfo> {
    // `git status -b --porcelain=v2` first line is `# branch.head <name>`,
    // followed by branch.upstream / branch.ab. Robust and machine-readable.
    const run = await runGit(cwd, [
        "status",
        "-b",
        "--porcelain=v2",
        "--untracked-files=no"
    ]);

    let branch: string | null = null;
    let detachedHead: string | undefined;
    let upstream: string | null = null;
    let ahead = 0;
    let behind = 0;

    if (run.exitCode !== 0) {
        return { branch, upstream, ahead, behind };
    }

    for (const line of run.stdout.split("\n")) {
        if (!line.startsWith("# branch.")) continue;
        const [, key, ...rest] = line.split(" ");
        const value = rest.join(" ");
        switch (key) {
            case "branch.head":
                if (value === "(detached)") branch = null;
                else branch = value;
                break;
            case "branch.oid":
                if (branch === null && value !== "(initial)") {
                    detachedHead = value.slice(0, 7);
                }
                break;
            case "branch.upstream":
                upstream = value || null;
                break;
            case "branch.ab": {
                // Format: `+<ahead> -<behind>`
                const match = value.match(/\+(\d+)\s+-(\d+)/);
                if (match) {
                    ahead = Number(match[1]);
                    behind = Number(match[2]);
                }
                break;
            }
        }
    }

    return { branch, detachedHead, upstream, ahead, behind };
}

// ─── Status parsing ──────────────────────────────────────────────────────────

function classifyCode(code: string): GitChangeKind {
    switch (code) {
        case "M":
            return "modified";
        case "A":
            return "added";
        case "D":
            return "deleted";
        case "R":
            return "renamed";
        case "C":
            return "copied";
        case "T":
            return "type-changed";
        case "U":
            return "conflicted";
        case "?":
            return "untracked";
        default:
            return "modified";
    }
}

/**
 * Parse the NUL-delimited output of `git status -z --porcelain=v1`.
 *
 * The classic format is `XY␠path␀` with one extra path appended for renames
 * and copies (the new name comes first, then the old). We split by `\0` and
 * eagerly consume an extra slot whenever the index status is `R` or `C`.
 */
function parseStatusEntries(raw: string): {
    staged: GitFileChange[];
    unstaged: GitFileChange[];
    untracked: GitFileChange[];
    conflicted: GitFileChange[];
} {
    const entries = raw.split("\0").filter((s) => s.length > 0);
    const staged: GitFileChange[] = [];
    const unstaged: GitFileChange[] = [];
    const untracked: GitFileChange[] = [];
    const conflicted: GitFileChange[] = [];

    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i]!;
        // Format: "XY <path>" — XY is exactly 2 chars, then a space.
        if (entry.length < 4) continue;
        const xy = entry.slice(0, 2);
        const path = toPosix(entry.slice(3));
        const x = xy[0]!;
        const y = xy[1]!;

        // Renames / copies append the previous name as the next NUL chunk.
        let oldPath: string | undefined;
        if (x === "R" || x === "C" || y === "R" || y === "C") {
            const next = entries[i + 1];
            if (typeof next === "string") {
                oldPath = toPosix(next);
                i++;
            }
        }

        const isConflict =
            x === "U" ||
            y === "U" ||
            (x === "A" && y === "A") ||
            (x === "D" && y === "D");

        if (isConflict) {
            conflicted.push({
                path,
                oldPath,
                side: "unstaged",
                kind: "conflicted",
                conflicted: true,
                additions: null,
                deletions: null,
                binary: false
            });
            continue;
        }

        if (x === "?" && y === "?") {
            untracked.push({
                path,
                side: "unstaged",
                kind: "untracked",
                conflicted: false,
                additions: null,
                deletions: null,
                binary: false
            });
            continue;
        }

        if (x !== " " && x !== "?") {
            staged.push({
                path,
                oldPath,
                side: "staged",
                kind: classifyCode(x),
                conflicted: false,
                additions: null,
                deletions: null,
                binary: false
            });
        }
        if (y !== " " && y !== "?") {
            unstaged.push({
                path,
                oldPath,
                side: "unstaged",
                kind: classifyCode(y),
                conflicted: false,
                additions: null,
                deletions: null,
                binary: false
            });
        }
    }

    return { staged, unstaged, untracked, conflicted };
}

/**
 * Parse `git diff --numstat -z` output and decorate the matching changes
 * with line-count metadata. Numstat reports `-\t-\t<path>` for binary
 * files, which we surface as `binary: true` on the row.
 */
function applyNumstat(
    raw: string,
    rows: GitFileChange[],
    side: GitFileChange["side"]
): void {
    if (!raw) return;

    // -z output format for numstat:
    //   <added>\t<deleted>\t<path>\0
    //   For renames: <added>\t<deleted>\t\0<old>\0<new>\0
    const tokens = raw.split("\0").filter((t) => t.length > 0);

    type NumStat = {
        path: string;
        adds: number | null;
        dels: number | null;
        binary: boolean;
    };
    const stats: NumStat[] = [];

    let i = 0;
    while (i < tokens.length) {
        const head = tokens[i]!;
        // A "header" token contains two tabs.
        if (!head.includes("\t")) {
            i++;
            continue;
        }
        const parts = head.split("\t");
        const addsRaw = parts[0] ?? "";
        const delsRaw = parts[1] ?? "";
        const inlinePath = parts[2] ?? "";

        const binary = addsRaw === "-" && delsRaw === "-";
        const adds = binary ? null : Number(addsRaw);
        const dels = binary ? null : Number(delsRaw);

        if (inlinePath.length > 0) {
            // Plain entry: `\t` immediately followed by path on the same chunk.
            stats.push({ path: toPosix(inlinePath), adds, dels, binary });
            i++;
        } else {
            // Rename/copy: two more tokens follow (old, new).
            const oldName = tokens[i + 1] ?? "";
            const newName = tokens[i + 2] ?? "";
            stats.push({
                path: toPosix(newName || oldName),
                adds,
                dels,
                binary
            });
            i += 3;
        }
    }

    const byPath = new Map<string, NumStat>();
    for (const s of stats) byPath.set(s.path, s);

    for (const row of rows) {
        if (row.side !== side) continue;
        const stat = byPath.get(row.path);
        if (!stat) continue;
        row.additions = stat.adds;
        row.deletions = stat.dels;
        row.binary = stat.binary;
    }
}

async function loadUntrackedLineCounts(
    workspaceRoot: string,
    rows: GitFileChange[]
): Promise<void> {
    // `git diff --numstat` does not cover untracked files, so we read each
    // file from disk and count lines ourselves. Bounded by the same 1 MB
    // ceiling we use for the diff body.
    await Promise.all(
        rows.map(async (row) => {
            try {
                const abs = join(workspaceRoot, row.path);
                const st = await stat(abs);
                if (!st.isFile()) return;
                if (st.size === 0) {
                    row.additions = 0;
                    row.deletions = 0;
                    return;
                }
                if (st.size > MAX_DIFF_FILE_BYTES) {
                    return;
                }
                const buf = (await readFile(abs)) as Buffer;
                if (looksBinary(buf)) {
                    row.binary = true;
                    return;
                }
                const text = buf.toString("utf8");
                let count = 0;
                for (let i = 0; i < text.length; i++) {
                    if (text.charCodeAt(i) === 10) count++;
                }
                if (text.length > 0 && !text.endsWith("\n")) count++;
                row.additions = count;
                row.deletions = 0;
            } catch {
                /* best-effort */
            }
        })
    );
}

function looksBinary(buffer: Buffer): boolean {
    const sampleSize = Math.min(buffer.length, 8192);
    for (let i = 0; i < sampleSize; i++) {
        if (buffer[i] === 0) return true;
    }
    return false;
}

// ─── Public surface ──────────────────────────────────────────────────────────

export async function getStatus(workspaceId: string): Promise<GitStatus> {
    const workspace = getWorkspace(workspaceId);
    const cwd = resolve(workspace.path);

    const isRepo = await detectRepo(cwd);
    if (!isRepo) {
        return {
            workspaceId,
            isRepo: false,
            branch: { branch: null, upstream: null, ahead: 0, behind: 0 },
            staged: [],
            unstaged: [],
            untracked: [],
            conflicted: []
        };
    }

    const [statusRun, branch, stagedNumstat, unstagedNumstat] =
        await Promise.all([
            runGit(cwd, [
                "status",
                "-z",
                "--porcelain=v1",
                "--untracked-files=all"
            ]),
            readBranchInfo(cwd),
            runGit(cwd, ["diff", "--cached", "--numstat", "-z"]),
            runGit(cwd, ["diff", "--numstat", "-z"])
        ]);

    if (statusRun.exitCode !== 0) {
        throw new Error(
            statusRun.stderr.trim() || "git status failed unexpectedly"
        );
    }

    const buckets = parseStatusEntries(statusRun.stdout);

    applyNumstat(stagedNumstat.stdout, buckets.staged, "staged");
    applyNumstat(unstagedNumstat.stdout, buckets.unstaged, "unstaged");
    if (buckets.untracked.length > 0) {
        await loadUntrackedLineCounts(cwd, buckets.untracked);
    }

    const sortByPath = (a: GitFileChange, b: GitFileChange) =>
        a.path.localeCompare(b.path, undefined, { sensitivity: "base" });
    buckets.staged.sort(sortByPath);
    buckets.unstaged.sort(sortByPath);
    buckets.untracked.sort(sortByPath);
    buckets.conflicted.sort(sortByPath);

    return {
        workspaceId,
        isRepo: true,
        branch,
        staged: buckets.staged,
        unstaged: buckets.unstaged,
        untracked: buckets.untracked,
        conflicted: buckets.conflicted
    };
}

// ─── Diff loading ────────────────────────────────────────────────────────────

async function readBlobAtRevision(
    cwd: string,
    spec: string
): Promise<{ contents: string; binary: boolean; missing: boolean }> {
    // `git cat-file -e <spec>` returns 0 when the object exists, non-zero
    // otherwise. We use it as a precondition so we can distinguish "file
    // didn't exist on this side" from a real error.
    const exists = await runGit(cwd, ["cat-file", "-e", spec], {
        timeoutMs: 5_000
    });
    if (exists.exitCode !== 0) {
        return { contents: "", binary: false, missing: true };
    }

    // Detect binary first to keep `git show`'s buffered output bounded for
    // huge artifacts.
    const sizeRun = await runGit(cwd, ["cat-file", "-s", spec], {
        timeoutMs: 5_000
    });
    const size = Number(sizeRun.stdout.trim());
    if (Number.isFinite(size) && size > MAX_DIFF_FILE_BYTES) {
        return { contents: "", binary: true, missing: false };
    }

    const show = await runGit(cwd, ["show", spec], { timeoutMs: 10_000 });
    if (show.exitCode !== 0) {
        return { contents: "", binary: false, missing: true };
    }

    if (looksBinary(Buffer.from(show.stdout, "utf8"))) {
        return { contents: "", binary: true, missing: false };
    }

    return { contents: show.stdout, binary: false, missing: false };
}

async function readWorktreeFile(
    workspaceRoot: string,
    relPath: string
): Promise<{ contents: string; binary: boolean; missing: boolean }> {
    try {
        const abs = join(workspaceRoot, relPath);
        const st = await stat(abs);
        if (!st.isFile()) {
            return { contents: "", binary: false, missing: true };
        }
        if (st.size > MAX_DIFF_FILE_BYTES) {
            return { contents: "", binary: true, missing: false };
        }
        const buf = (await readFile(abs)) as Buffer;
        if (looksBinary(buf)) {
            return { contents: "", binary: true, missing: false };
        }
        return {
            contents: buf.toString("utf8"),
            binary: false,
            missing: false
        };
    } catch {
        return { contents: "", binary: false, missing: true };
    }
}

export async function getFileDiff(
    workspaceId: string,
    requestedPath: string,
    side: "staged" | "unstaged" | "combined" = "combined",
    oldRequestedPath?: string
): Promise<GitFileDiff> {
    const { workspace, root, posix } = resolveWorkspacePath(
        workspaceId,
        requestedPath
    );
    const cwd = resolve(workspace.path);

    // For renames/copies the porcelain entry carries the old path on the
    // index side. We use it as the "old revision" lookup so the diff shows
    // the actual rename instead of degenerating into an add+delete pair.
    let oldPosix: string | undefined;
    if (oldRequestedPath && oldRequestedPath.length > 0) {
        try {
            ({ posix: oldPosix } = resolveWorkspacePath(
                workspaceId,
                oldRequestedPath
            ));
        } catch {
            oldPosix = undefined;
        }
    }
    const oldKey = oldPosix ?? posix;

    const isRepo = await detectRepo(cwd);
    if (!isRepo) {
        return {
            workspaceId,
            path: posix,
            oldPath: oldPosix,
            side,
            binary: false,
            oldContents: "",
            newContents: ""
        };
    }

    if (side === "staged") {
        const oldRev = await readBlobAtRevision(cwd, `HEAD:${oldKey}`);
        const newRev = await readBlobAtRevision(cwd, `:${posix}`);
        return {
            workspaceId,
            path: posix,
            oldPath: oldPosix,
            side,
            binary: oldRev.binary || newRev.binary,
            oldContents: oldRev.contents,
            newContents: newRev.contents
        };
    }

    if (side === "unstaged") {
        const oldRev = await readBlobAtRevision(cwd, `:${posix}`);
        // Fall back to HEAD when the file is fully untracked (no index entry).
        const baseline = oldRev.missing
            ? await readBlobAtRevision(cwd, `HEAD:${oldKey}`)
            : oldRev;
        const newRev = await readWorktreeFile(root, posix);
        return {
            workspaceId,
            path: posix,
            oldPath: oldPosix,
            side,
            binary: baseline.binary || newRev.binary,
            oldContents: baseline.contents,
            newContents: newRev.contents
        };
    }

    // combined: HEAD vs working tree — covers both staged and unstaged
    // edits at once and gives an untracked file an empty baseline.
    const oldRev = await readBlobAtRevision(cwd, `HEAD:${oldKey}`);
    const newRev = await readWorktreeFile(root, posix);
    return {
        workspaceId,
        path: posix,
        oldPath: oldPosix,
        side: "combined",
        binary: oldRev.binary || newRev.binary,
        oldContents: oldRev.contents,
        newContents: newRev.contents
    };
}

// ─── Mutating actions ────────────────────────────────────────────────────────

async function runGitOrThrow(cwd: string, args: string[]): Promise<string> {
    const run = await runGit(cwd, args);
    if (run.timedOut) {
        throw new Error(`git ${args[0]} timed out`);
    }
    if (run.exitCode !== 0) {
        const detail = run.stderr.trim() || run.stdout.trim();
        throw new Error(detail || `git ${args[0]} failed`);
    }
    return run.stdout;
}

export async function stagePaths(
    workspaceId: string,
    paths: string[]
): Promise<void> {
    if (paths.length === 0) return;
    const workspace = getWorkspace(workspaceId);
    const cwd = resolve(workspace.path);

    const cleaned: string[] = [];
    for (const p of paths) {
        const { posix } = resolveWorkspacePath(workspaceId, p);
        cleaned.push(posix);
    }
    // `git add -A --` honors deletions too, which is what the user expects
    // when staging a file we report as Deleted.
    await runGitOrThrow(cwd, ["add", "-A", "--", ...cleaned]);
}

export async function unstagePaths(
    workspaceId: string,
    paths: string[]
): Promise<void> {
    if (paths.length === 0) return;
    const workspace = getWorkspace(workspaceId);
    const cwd = resolve(workspace.path);

    const cleaned: string[] = [];
    for (const p of paths) {
        const { posix } = resolveWorkspacePath(workspaceId, p);
        cleaned.push(posix);
    }

    // `git reset HEAD --` works on every git version and across initial
    // commits more reliably than `git restore --staged`.
    const run = await runGit(cwd, ["reset", "HEAD", "--", ...cleaned]);
    // `git reset` exits 1 when there are unstaged changes after the reset
    // — that's not an error, so we allow exit 0 or 1 here.
    if (run.timedOut || (run.exitCode !== 0 && run.exitCode !== 1)) {
        const detail = run.stderr.trim() || run.stdout.trim();
        throw new Error(detail || "git reset failed");
    }
}

export async function stageAll(workspaceId: string): Promise<void> {
    const workspace = getWorkspace(workspaceId);
    const cwd = resolve(workspace.path);
    await runGitOrThrow(cwd, ["add", "-A"]);
}

export async function unstageAll(workspaceId: string): Promise<void> {
    const workspace = getWorkspace(workspaceId);
    const cwd = resolve(workspace.path);
    const run = await runGit(cwd, ["reset", "HEAD"]);
    if (run.timedOut || (run.exitCode !== 0 && run.exitCode !== 1)) {
        const detail = run.stderr.trim() || run.stdout.trim();
        throw new Error(detail || "git reset failed");
    }
}

export async function commit(
    workspaceId: string,
    message: string,
    options: { allowEmpty?: boolean; signoff?: boolean } = {}
): Promise<GitCommitResult> {
    const trimmed = message.trim();
    if (trimmed.length === 0) {
        throw new Error("Commit message cannot be empty");
    }

    const workspace = getWorkspace(workspaceId);
    const cwd = resolve(workspace.path);

    // Pass the message via stdin (`-F -`) so we don't have to worry about
    // shell quoting, multi-line messages, or platform-specific escapes.
    const args: string[] = ["commit", "-F", "-", "--cleanup=strip"];
    if (options.allowEmpty) args.push("--allow-empty");
    if (options.signoff) args.push("--signoff");

    const run = await runGit(cwd, args, { stdin: trimmed });
    if (run.timedOut) throw new Error("git commit timed out");
    if (run.exitCode !== 0) {
        const detail = run.stderr.trim() || run.stdout.trim();
        throw new Error(detail || "git commit failed");
    }

    // Pull back the SHA + branch so the UI can show a friendly toast.
    const [shaRun, branch] = await Promise.all([
        runGit(cwd, ["rev-parse", "--short", "HEAD"], { timeoutMs: 5_000 }),
        readBranchInfo(cwd)
    ]);

    return {
        workspaceId,
        sha: shaRun.exitCode === 0 ? shaRun.stdout.trim() : "",
        branch: branch.branch,
        summary: trimmed.split(/\r?\n/, 1)[0] ?? trimmed
    };
}

export async function discardPath(
    workspaceId: string,
    requestedPath: string
): Promise<void> {
    const { workspace, root, posix } = resolveWorkspacePath(
        workspaceId,
        requestedPath
    );
    const cwd = resolve(workspace.path);

    // Untracked → just remove the file from disk. No git command will help
    // because git doesn't know about the file yet.
    const status = await runGit(cwd, [
        "status",
        "--porcelain=v1",
        "-z",
        "--",
        posix
    ]);
    const entry = status.stdout.split("\0").find((e) => e.length > 0) ?? "";
    if (entry.startsWith("??")) {
        const { unlink } = await import("node:fs/promises");
        await unlink(join(root, posix));
        return;
    }

    // Tracked → restore from index (recreates the file if it was deleted).
    await runGitOrThrow(cwd, ["checkout", "HEAD", "--", posix]);
}
