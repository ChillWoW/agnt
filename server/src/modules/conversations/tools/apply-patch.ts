import { z } from "zod";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { logger } from "../../../lib/logger";
import type { ToolDefinition, ToolModelOutput } from "./types";
import { resolveWorkspacePath, toPosix } from "./workspace-path";

// ─── Limits ───────────────────────────────────────────────────────────────────

/** Hard cap on a single file we will read/write through apply_patch. */
const HARD_MAX_BYTES = 10 * 1024 * 1024; // 10 MiB
/** Hard cap on the full patch text. */
const HARD_MAX_PATCH_BYTES = 32 * 1024 * 1024; // 32 MiB

// ─── Schema ───────────────────────────────────────────────────────────────────

export const applyPatchInputSchema = z.object({
    input: z
        .string()
        .min(1)
        .describe(
            [
                "The complete V4A patch envelope as plain text. Must start with `*** Begin Patch` and end with `*** End Patch`.",
                "",
                "Supported sections (in any order, multiple per patch):",
                "  *** Add File: <path>",
                '    …every body line is prefixed with "+" and becomes file contents',
                "  *** Delete File: <path>",
                "  *** Update File: <path>",
                "    *** Move to: <newPath>   (optional, renames the file)",
                "    @@ <anchor>               (optional, one or more — anchors the hunk)",
                "    <unchanged context line>  (prefix is a single space)",
                "    -<line removed>",
                "    +<line added>",
                "",
                "Rules:",
                "  • Context lines use a leading space. Deletions use `-`. Additions use `+`.",
                "  • Include 1–3 lines of unchanged context on each side of an edit so the match is unique.",
                "  • `@@ <anchor>` lines are optional helpers that narrow the search to lines below a given signature (e.g. `@@ def compute_total():`). Stack multiple `@@` lines to disambiguate nested scopes.",
                "  • Multiple hunks in one `Update File` are allowed — each new `@@` (or a blank separator followed by a fresh context block) starts a new hunk.",
                "  • Paths follow the same rules as `write` / `str_replace`: workspace-relative (`src/foo.ts`) or workspace-root-relative (`/src/foo.ts`), containment enforced.",
                "  • Line endings are matched flexibly against LF and CRLF; files that currently use CRLF keep CRLF after the edit."
            ].join("\n")
        )
});

export type ApplyPatchInput = z.infer<typeof applyPatchInputSchema>;

// ─── Output shape ─────────────────────────────────────────────────────────────

export type ApplyPatchOp = "add" | "update" | "delete" | "rename";

export interface ApplyPatchChange {
    op: ApplyPatchOp;
    path: string;
    relativePath: string;
    newPath?: string;
    newRelativePath?: string;
    oldContents: string;
    newContents: string;
    linesAdded: number;
    linesRemoved: number;
    createdDirectories: string[];
}

export interface ApplyPatchSummary {
    filesChanged: number;
    filesAdded: number;
    filesDeleted: number;
    filesUpdated: number;
    filesRenamed: number;
    linesAdded: number;
    linesRemoved: number;
}

export interface ApplyPatchOutput {
    ok: true;
    changes: ApplyPatchChange[];
    summary: ApplyPatchSummary;
}

// ─── Parser: patch text → structured actions ─────────────────────────────────

type HunkLine =
    | { kind: "context"; text: string }
    | { kind: "delete"; text: string }
    | { kind: "add"; text: string };

interface Hunk {
    anchors: string[];
    lines: HunkLine[];
}

type ParsedAction =
    | { kind: "add"; path: string; body: string[] }
    | { kind: "delete"; path: string }
    | {
          kind: "update";
          path: string;
          moveTo?: string;
          hunks: Hunk[];
      };

const BEGIN_RE = /^\s*\*\*\*\s*Begin Patch\s*$/;
const END_RE = /^\s*\*\*\*\s*End Patch\s*$/;
const ADD_RE = /^\*\*\*\s*Add File:\s*(.+?)\s*$/;
const DELETE_RE = /^\*\*\*\s*Delete File:\s*(.+?)\s*$/;
const UPDATE_RE = /^\*\*\*\s*Update File:\s*(.+?)\s*$/;
const MOVE_RE = /^\*\*\*\s*Move to:\s*(.+?)\s*$/;
const EOF_RE = /^\*\*\*\s*End of File\s*$/;
const HUNK_ANCHOR_RE = /^@@\s?(.*)$/;

/**
 * Strip common wrappers models like to emit around the patch payload:
 * fenced code blocks (``` / ```diff / ```patch), leading `apply_patch <<"EOF"`
 * heredoc wrappers, trailing `EOF`. We tolerate these so a minor formatting
 * slip doesn't fail the whole call.
 */
function normalizePatchText(raw: string): string {
    let text = raw.replace(/^\uFEFF/, ""); // strip BOM
    // Normalize to LF for parsing; we'll restore CRLF per-file later.
    text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

    // Strip a single surrounding ```...``` fence if present.
    const fenceMatch = text.match(/^\s*```[^\n]*\n([\s\S]*?)\n```\s*$/);
    if (fenceMatch) {
        text = fenceMatch[1]!;
    }

    // Strip a leading `apply_patch << "EOF"` / `<<EOF` heredoc wrapper.
    const heredoc = text.match(
        /^\s*apply_patch\s*<<\s*["']?(\w+)["']?\s*\n([\s\S]*?)\n\s*\1\s*$/
    );
    if (heredoc) {
        text = heredoc[2]!;
    }

    return text;
}

function parsePatch(rawPatch: string): ParsedAction[] {
    const normalized = normalizePatchText(rawPatch);
    const allLines = normalized.split("\n");

    // Locate Begin Patch / End Patch markers (tolerant: if missing, treat
    // the whole body as the patch — caller can still err on an empty parse).
    let start = 0;
    let end = allLines.length;
    const beginIdx = allLines.findIndex((l) => BEGIN_RE.test(l));
    if (beginIdx >= 0) start = beginIdx + 1;
    const endIdx = allLines.findIndex((l, i) => i >= start && END_RE.test(l));
    if (endIdx >= 0) end = endIdx;

    if (beginIdx < 0) {
        throw new Error(
            "apply_patch: missing `*** Begin Patch` header. Wrap the diff in `*** Begin Patch` / `*** End Patch` markers."
        );
    }
    if (endIdx < 0) {
        throw new Error(
            "apply_patch: missing `*** End Patch` footer. The patch envelope must be closed."
        );
    }

    const lines = allLines.slice(start, end);
    const actions: ParsedAction[] = [];

    let i = 0;
    while (i < lines.length) {
        const line = lines[i]!;
        if (line.trim().length === 0) {
            i++;
            continue;
        }

        let m: RegExpMatchArray | null;

        if ((m = line.match(ADD_RE))) {
            const path = m[1]!.trim();
            const body: string[] = [];
            i++;
            while (i < lines.length) {
                const cur = lines[i]!;
                if (
                    ADD_RE.test(cur) ||
                    DELETE_RE.test(cur) ||
                    UPDATE_RE.test(cur) ||
                    END_RE.test(cur)
                ) {
                    break;
                }
                if (EOF_RE.test(cur)) {
                    i++;
                    continue;
                }
                if (cur.startsWith("+")) {
                    body.push(cur.slice(1));
                } else if (cur.trim().length === 0) {
                    body.push("");
                } else {
                    throw new Error(
                        `apply_patch: inside \`Add File: ${path}\`, every content line must start with "+". Got: ${JSON.stringify(cur)}`
                    );
                }
                i++;
            }
            actions.push({ kind: "add", path, body });
            continue;
        }

        if ((m = line.match(DELETE_RE))) {
            actions.push({ kind: "delete", path: m[1]!.trim() });
            i++;
            continue;
        }

        if ((m = line.match(UPDATE_RE))) {
            const path = m[1]!.trim();
            let moveTo: string | undefined;
            const hunks: Hunk[] = [];
            i++;

            // Optional Move to
            if (i < lines.length) {
                const mv = lines[i]!.match(MOVE_RE);
                if (mv) {
                    moveTo = mv[1]!.trim();
                    i++;
                }
            }

            let current: Hunk | null = null;
            let pendingAnchors: string[] = [];

            while (i < lines.length) {
                const cur = lines[i]!;

                if (
                    ADD_RE.test(cur) ||
                    DELETE_RE.test(cur) ||
                    UPDATE_RE.test(cur) ||
                    END_RE.test(cur)
                ) {
                    break;
                }

                if (EOF_RE.test(cur)) {
                    i++;
                    continue;
                }

                const hunkMatch = cur.match(HUNK_ANCHOR_RE);
                if (hunkMatch) {
                    // A `@@` that arrives AFTER we already collected lines
                    // for the current hunk starts a new hunk.
                    if (current && current.lines.length > 0) {
                        hunks.push(current);
                        current = null;
                    }
                    pendingAnchors.push(hunkMatch[1]!);
                    i++;
                    continue;
                }

                if (cur.length === 0) {
                    // Blank line inside a hunk body = blank context line.
                    if (current) {
                        current.lines.push({ kind: "context", text: "" });
                    }
                    i++;
                    continue;
                }

                const prefix = cur[0]!;
                const body = cur.slice(1);

                if (prefix !== " " && prefix !== "+" && prefix !== "-") {
                    throw new Error(
                        `apply_patch: inside \`Update File: ${path}\`, hunk line must start with " ", "-", or "+". Got: ${JSON.stringify(cur)}`
                    );
                }

                if (!current) {
                    current = { anchors: pendingAnchors, lines: [] };
                    pendingAnchors = [];
                }

                if (prefix === " ") current.lines.push({ kind: "context", text: body });
                else if (prefix === "-") current.lines.push({ kind: "delete", text: body });
                else current.lines.push({ kind: "add", text: body });
                i++;
            }

            if (current && current.lines.length > 0) hunks.push(current);

            if (hunks.length === 0) {
                throw new Error(
                    `apply_patch: \`Update File: ${path}\` must contain at least one hunk with context/± lines.`
                );
            }

            actions.push({ kind: "update", path, moveTo, hunks });
            continue;
        }

        throw new Error(
            `apply_patch: unexpected line outside any file section: ${JSON.stringify(line)}`
        );
    }

    if (actions.length === 0) {
        throw new Error(
            "apply_patch: no file sections found. Expected at least one of `*** Add File:`, `*** Update File:`, or `*** Delete File:`."
        );
    }

    return actions;
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
    const root = resolve(workspaceRoot);
    const created: string[] = [];
    const visited: string[] = [];
    let cursor = absoluteDir;
    while (cursor.length > 0 && cursor.startsWith(root) && cursor !== root) {
        visited.push(cursor);
        const parent = dirname(cursor);
        if (parent === cursor) break;
        cursor = parent;
    }
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

function looksBinary(buffer: Buffer): boolean {
    const sampleSize = Math.min(buffer.length, 8192);
    for (let i = 0; i < sampleSize; i++) {
        if (buffer[i] === 0) return true;
    }
    return false;
}

function detectEol(text: string): "\r\n" | "\n" {
    return /\r\n/.test(text) ? "\r\n" : "\n";
}

function normalizeToLf(text: string): string {
    return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function reapplyEol(text: string, eol: "\r\n" | "\n"): string {
    if (eol === "\n") return text;
    return text.replace(/\n/g, "\r\n");
}

function countLines(text: string): number {
    if (text.length === 0) return 0;
    const n = text.split("\n");
    if (n.length > 0 && n[n.length - 1] === "") n.pop();
    return n.length;
}

/**
 * Locate a unique occurrence of `needle` in `haystack`, optionally narrowed
 * by a stack of `@@`-style anchor strings. Returns the character offset where
 * the match starts, or throws a descriptive error for zero / ambiguous matches.
 *
 * `haystack` and `needle` are both LF-normalized strings. Anchor narrowing
 * works by walking anchors in order, each time advancing the search window to
 * the first line *at or after* the current cursor whose content contains the
 * anchor; the hunk match must then occur after that point.
 */
function findHunkOffset(
    haystack: string,
    needle: string,
    anchors: string[],
    path: string
): number {
    let searchStart = 0;

    if (anchors.length > 0) {
        // Walk each anchor in order, advancing the cursor past its match.
        for (const rawAnchor of anchors) {
            const anchor = rawAnchor.trim();
            if (anchor.length === 0) continue;
            // Find a line (starting at searchStart) whose content contains
            // the anchor substring. Anchors are intentionally fuzzy — they
            // quote a signature, not an exact line.
            let lineStart = searchStart;
            let found = -1;
            while (lineStart <= haystack.length) {
                const nextNl = haystack.indexOf("\n", lineStart);
                const lineEnd = nextNl === -1 ? haystack.length : nextNl;
                const line = haystack.slice(lineStart, lineEnd);
                if (line.includes(anchor)) {
                    found = lineEnd + 1;
                    break;
                }
                if (nextNl === -1) break;
                lineStart = nextNl + 1;
            }
            if (found === -1) {
                throw new Error(
                    `apply_patch: anchor \`@@ ${anchor}\` not found in ${path}. Double-check the function/class signature you used to anchor the hunk.`
                );
            }
            searchStart = found;
        }
    }

    // Count occurrences of needle in the (possibly narrowed) window.
    let occurrences = 0;
    let firstAt = -1;
    let from = searchStart;
    while (true) {
        const idx = haystack.indexOf(needle, from);
        if (idx === -1) break;
        if (occurrences === 0) firstAt = idx;
        occurrences++;
        from = idx + Math.max(1, needle.length);
        if (occurrences > 1) break;
    }

    if (occurrences === 0) {
        // Retry without anchor narrowing so the error message can tell the
        // model whether the issue is the anchor or the context text itself.
        const globalCount = (() => {
            let c = 0;
            let f = 0;
            while (true) {
                const i = haystack.indexOf(needle, f);
                if (i === -1) break;
                c++;
                f = i + Math.max(1, needle.length);
            }
            return c;
        })();

        if (globalCount > 0) {
            throw new Error(
                `apply_patch: hunk context did not match inside the \`@@\` anchor region for ${path} (but matches ${globalCount} time(s) elsewhere in the file). Re-check the anchor line or drop the anchor.`
            );
        }
        throw new Error(
            `apply_patch: hunk context not found in ${path}. Verify the unchanged context lines match the file verbatim (whitespace included).`
        );
    }

    if (occurrences > 1) {
        throw new Error(
            `apply_patch: hunk context matches ${occurrences} places in ${path}. Add more surrounding context lines (or a tighter \`@@\` anchor) to disambiguate.`
        );
    }

    return firstAt;
}

/**
 * Apply a single hunk to the current file contents (LF-normalized) and return
 * the updated contents plus counts. Each hunk contributes its additions and
 * deletions independently.
 */
function applyHunk(
    contentsLf: string,
    hunk: Hunk,
    path: string
): { after: string; linesAdded: number; linesRemoved: number } {
    const beforeParts: string[] = [];
    const afterParts: string[] = [];
    let linesAdded = 0;
    let linesRemoved = 0;

    for (const l of hunk.lines) {
        if (l.kind === "context") {
            beforeParts.push(l.text);
            afterParts.push(l.text);
        } else if (l.kind === "delete") {
            beforeParts.push(l.text);
            linesRemoved++;
        } else {
            afterParts.push(l.text);
            linesAdded++;
        }
    }

    const before = beforeParts.join("\n");
    const after = afterParts.join("\n");

    if (before.length === 0 && linesAdded > 0 && linesRemoved === 0) {
        // Pure prepend at the top of file if the hunk has no context.
        return {
            after:
                after.length === 0
                    ? contentsLf
                    : after + (contentsLf.length > 0 ? "\n" + contentsLf : ""),
            linesAdded,
            linesRemoved
        };
    }

    const offset = findHunkOffset(contentsLf, before, hunk.anchors, path);
    const updated =
        contentsLf.slice(0, offset) +
        after +
        contentsLf.slice(offset + before.length);

    return { after: updated, linesAdded, linesRemoved };
}

// ─── Execute ──────────────────────────────────────────────────────────────────

function makeExecuteApplyPatch(workspacePath?: string) {
    return async function executeApplyPatch(
        input: ApplyPatchInput
    ): Promise<ApplyPatchOutput> {
        const patchText = input.input;
        if (Buffer.byteLength(patchText, "utf8") > HARD_MAX_PATCH_BYTES) {
            throw new Error(
                `apply_patch: patch payload too large (cap ${HARD_MAX_PATCH_BYTES} bytes). Split into multiple calls.`
            );
        }

        const actions = parsePatch(patchText);

        // ── Pre-flight: resolve paths, read originals, plan changes. Doing
        //    this ahead of any write means a mid-patch failure can't leave
        //    half the tree mutated. (We still can't guarantee true atomicity
        //    across many files on crash, but errors at least abort early.)
        type PlannedChange = {
            action: ParsedAction;
            absolute: string;
            relative: string;
            absoluteNew?: string;
            relativeNew?: string;
            existing: { exists: boolean; isFile: boolean; size: number };
            originalLf: string;
            originalEol: "\r\n" | "\n";
        };

        const planned: PlannedChange[] = [];

        for (const action of actions) {
            const { absolute, relative: relPath } = resolveWorkspacePath(
                action.path,
                workspacePath,
                "apply_patch"
            );
            let absoluteNew: string | undefined;
            let relativeNew: string | undefined;
            if (action.kind === "update" && action.moveTo) {
                const resolvedNew = resolveWorkspacePath(
                    action.moveTo,
                    workspacePath,
                    "apply_patch"
                );
                absoluteNew = resolvedNew.absolute;
                relativeNew = resolvedNew.relative;
            }

            const existing = await fileExists(absolute);

            if (action.kind === "add") {
                if (existing.exists) {
                    throw new Error(
                        `apply_patch: \`Add File: ${action.path}\` but file already exists at ${absolute}. Use \`Update File\` (or delete + add) to overwrite.`
                    );
                }
                planned.push({
                    action,
                    absolute,
                    relative: relPath,
                    existing,
                    originalLf: "",
                    originalEol: "\n"
                });
                continue;
            }

            if (action.kind === "delete") {
                if (!existing.exists) {
                    throw new Error(
                        `apply_patch: \`Delete File: ${action.path}\` but file does not exist at ${absolute}.`
                    );
                }
                if (!existing.isFile) {
                    throw new Error(
                        `apply_patch: \`Delete File: ${action.path}\` is not a regular file.`
                    );
                }
                planned.push({
                    action,
                    absolute,
                    relative: relPath,
                    existing,
                    originalLf: "",
                    originalEol: "\n"
                });
                continue;
            }

            // update
            if (!existing.exists) {
                throw new Error(
                    `apply_patch: \`Update File: ${action.path}\` but file does not exist at ${absolute}. Use \`Add File\` to create it.`
                );
            }
            if (!existing.isFile) {
                throw new Error(
                    `apply_patch: \`Update File: ${action.path}\` is not a regular file.`
                );
            }
            if (existing.size > HARD_MAX_BYTES) {
                throw new Error(
                    `apply_patch: file too large for in-place edit: ${absolute} (${existing.size} bytes, cap ${HARD_MAX_BYTES}).`
                );
            }
            const buf = (await readFile(absolute)) as Buffer;
            if (looksBinary(buf)) {
                throw new Error(
                    `apply_patch: refusing to edit binary file ${absolute}.`
                );
            }
            const text = buf.toString("utf8");
            planned.push({
                action,
                absolute,
                relative: relPath,
                absoluteNew,
                relativeNew,
                existing,
                originalLf: normalizeToLf(text),
                originalEol: detectEol(text)
            });
        }

        // ── Apply: compute new contents in memory, then commit to disk.
        const changes: ApplyPatchChange[] = [];
        const summary: ApplyPatchSummary = {
            filesChanged: 0,
            filesAdded: 0,
            filesDeleted: 0,
            filesUpdated: 0,
            filesRenamed: 0,
            linesAdded: 0,
            linesRemoved: 0
        };

        for (const plan of planned) {
            const { action } = plan;

            if (action.kind === "add") {
                // body is an array of (logical) lines; join with LF for preview,
                // write with LF as the default since the file is new.
                const newLf = action.body.join("\n");
                // Preserve trailing newline if the body ends with a "+<blank>"
                // line (join leaves "" there, which adds the trailing "\n").
                const createdDirectories = await ensureDirectory(
                    dirname(plan.absolute),
                    workspacePath ??
                        resolve(plan.absolute).split(/[\\/]/).slice(0, 1).join("/")
                );
                await writeFile(plan.absolute, newLf, "utf8");
                const linesAdded = countLines(newLf);
                changes.push({
                    op: "add",
                    path: plan.absolute,
                    relativePath: toPosix(plan.relative),
                    oldContents: "",
                    newContents: newLf,
                    linesAdded,
                    linesRemoved: 0,
                    createdDirectories
                });
                summary.filesAdded++;
                summary.filesChanged++;
                summary.linesAdded += linesAdded;
                continue;
            }

            if (action.kind === "delete") {
                const originalBuf = (await readFile(plan.absolute)) as Buffer;
                const originalText = originalBuf.toString("utf8");
                await unlink(plan.absolute);
                const linesRemoved = countLines(normalizeToLf(originalText));
                changes.push({
                    op: "delete",
                    path: plan.absolute,
                    relativePath: toPosix(plan.relative),
                    oldContents: originalText,
                    newContents: "",
                    linesAdded: 0,
                    linesRemoved,
                    createdDirectories: []
                });
                summary.filesDeleted++;
                summary.filesChanged++;
                summary.linesRemoved += linesRemoved;
                continue;
            }

            // update (optionally with move)
            let current = plan.originalLf;
            let linesAdded = 0;
            let linesRemoved = 0;
            for (const hunk of action.hunks) {
                const res = applyHunk(current, hunk, plan.relative);
                current = res.after;
                linesAdded += res.linesAdded;
                linesRemoved += res.linesRemoved;
            }

            const finalText = reapplyEol(current, plan.originalEol);
            let createdDirectories: string[] = [];
            let targetAbsolute = plan.absolute;
            let targetRelative = plan.relative;

            if (plan.absoluteNew && plan.absoluteNew !== plan.absolute) {
                // Ensure the destination directory exists, then rename.
                createdDirectories = await ensureDirectory(
                    dirname(plan.absoluteNew),
                    workspacePath ??
                        resolve(plan.absoluteNew)
                            .split(/[\\/]/)
                            .slice(0, 1)
                            .join("/")
                );
                const destExists = await fileExists(plan.absoluteNew);
                if (destExists.exists) {
                    throw new Error(
                        `apply_patch: \`Move to: ${action.moveTo}\` but destination already exists at ${plan.absoluteNew}.`
                    );
                }
                await writeFile(plan.absolute, finalText, "utf8");
                await rename(plan.absolute, plan.absoluteNew);
                targetAbsolute = plan.absoluteNew;
                targetRelative = plan.relativeNew ?? plan.relative;
                summary.filesRenamed++;
            } else {
                await writeFile(plan.absolute, finalText, "utf8");
            }

            changes.push({
                op: plan.absoluteNew ? "rename" : "update",
                path: plan.absolute,
                relativePath: toPosix(plan.relative),
                newPath: plan.absoluteNew,
                newRelativePath: plan.relativeNew
                    ? toPosix(plan.relativeNew)
                    : undefined,
                oldContents: reapplyEol(plan.originalLf, plan.originalEol),
                newContents: finalText,
                linesAdded,
                linesRemoved,
                createdDirectories
            });
            summary.filesUpdated++;
            summary.filesChanged++;
            summary.linesAdded += linesAdded;
            summary.linesRemoved += linesRemoved;

            // Avoid unused-var warning if rename path wasn't taken.
            void targetAbsolute;
            void targetRelative;
        }

        logger.log("[tool:apply_patch]", {
            files: changes.length,
            summary
        });

        return { ok: true, changes, summary };
    };
}

// ─── Model output (compact text summary) ─────────────────────────────────────

function toApplyPatchModelOutput({
    output
}: {
    input: ApplyPatchInput;
    output: ApplyPatchOutput;
}): ToolModelOutput {
    if (!output.ok) {
        return { type: "json", value: output as unknown };
    }
    if (output.changes.length === 0) {
        return { type: "text", value: "apply_patch: no changes." };
    }
    const lines: string[] = [];
    lines.push(
        `Applied ${output.summary.filesChanged} file${output.summary.filesChanged === 1 ? "" : "s"} (+${output.summary.linesAdded} -${output.summary.linesRemoved}):`
    );
    for (const c of output.changes) {
        const path = c.relativePath || c.path;
        const target = c.newRelativePath
            ? ` → ${c.newRelativePath}`
            : "";
        if (c.op === "add") {
            lines.push(`  + add    ${path} (+${c.linesAdded})`);
        } else if (c.op === "delete") {
            lines.push(`  - delete ${path} (-${c.linesRemoved})`);
        } else if (c.op === "rename") {
            lines.push(
                `  ~ rename ${path}${target} (+${c.linesAdded} -${c.linesRemoved})`
            );
        } else {
            lines.push(
                `  ~ update ${path} (+${c.linesAdded} -${c.linesRemoved})`
            );
        }
    }
    return { type: "text", value: lines.join("\n") };
}

// ─── Description ──────────────────────────────────────────────────────────────

const TOOL_DESCRIPTION =
    "Apply a V4A-format patch (the same envelope format used by OpenAI Codex) to create, edit, rename, and/or delete files in the active workspace in ONE atomic call. " +
    "PREFER this tool for ANY file mutation once you're comfortable with the format — it is more token-efficient than `write`, safer than repeated `str_replace` calls, and lets you batch multi-file edits (common in refactors). " +
    "Fall back to `write` only when creating a large brand-new file where the `+`-prefixing overhead outweighs the benefit, and to `str_replace` only for a single trivial substitution.\n\n" +
    "Exact format:\n" +
    "```\n" +
    "*** Begin Patch\n" +
    "*** Update File: path/to/file.ts\n" +
    "@@ function compute():\n" +
    "     const x = 1;\n" +
    "-    const y = 2;\n" +
    "+    const y = 3;\n" +
    "     return x + y;\n" +
    "*** End Patch\n" +
    "```\n\n" +
    "Rules:\n" +
    "  • The envelope MUST be `*** Begin Patch` … `*** End Patch`.\n" +
    '  • Each section header is one of `*** Add File: <path>`, `*** Delete File: <path>`, or `*** Update File: <path>` (optionally followed by `*** Move to: <newPath>`).\n' +
    "  • Context lines use a leading SPACE, deletions use `-`, additions use `+`. `@@ <signature>` anchors are optional but help disambiguate.\n" +
    "  • Include 1–3 context lines on each side of every edit so the hunk matches uniquely.\n" +
    "  • `Add File` bodies use `+` on every line, including blank lines.\n" +
    "  • Paths follow `write` / `str_replace` rules (workspace-relative or `/`-prefixed root-relative; must resolve inside the workspace). Missing parent dirs for `Add File` / `Move to` are auto-created.\n" +
    "  • Line endings are matched flexibly; files that currently use CRLF keep CRLF.\n" +
    "  • Fails fast with a descriptive error on ambiguous or missing context, overlapping adds, or paths outside the workspace; no partial writes on the failing file.";

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createApplyPatchToolDef(
    workspacePath?: string
): ToolDefinition<ApplyPatchInput, ApplyPatchOutput> {
    return {
        name: "apply_patch",
        description: TOOL_DESCRIPTION,
        inputSchema: applyPatchInputSchema,
        execute: makeExecuteApplyPatch(workspacePath),
        toModelOutput: toApplyPatchModelOutput
    };
}

export const applyPatchToolDef = createApplyPatchToolDef();

// Parser + helpers are exported for tests and (in the future) a client-side
// preview renderer that wants to show per-file hunks while the input is still
// streaming in.
export { parsePatch, normalizePatchText };
export type { Hunk, HunkLine, ParsedAction };
