import { GitDiffIcon } from "@phosphor-icons/react";
import type { ToolInvocation } from "@/features/conversations/conversation-types";
import { useWorkspaceStore } from "@/features/workspaces";
import { usePaneWorkspaceId } from "@/features/split-panes";
import { PierreDiff } from "@/components/chat/PierreDiff";
import { ToolBlock } from "./shared/ToolBlock";
import { formatReadPath, isRecord } from "./shared/format";
import { extractPartialTopLevelStrings } from "./shared/partial-json";
import { PostEditDiagnostics } from "./shared/PostEditDiagnostics";

interface ApplyPatchInputShape {
    input?: string;
}

type ApplyPatchOp = "add" | "update" | "delete" | "rename";

interface ApplyPatchChangeShape {
    op?: ApplyPatchOp;
    path?: string;
    relativePath?: string;
    newPath?: string;
    newRelativePath?: string;
    oldContents?: string;
    newContents?: string;
    linesAdded?: number;
    linesRemoved?: number;
}

interface ApplyPatchSummaryShape {
    filesChanged?: number;
    filesAdded?: number;
    filesDeleted?: number;
    filesUpdated?: number;
    filesRenamed?: number;
    linesAdded?: number;
    linesRemoved?: number;
}

interface ApplyPatchOutputShape {
    ok?: boolean;
    changes?: ApplyPatchChangeShape[];
    summary?: ApplyPatchSummaryShape;
}

interface ParsedPatchFile {
    op: ApplyPatchOp;
    path: string;
    newPath?: string;
    /**
     * For add/delete, `before`/`after` are authoritative (full file content).
     * For update/rename while streaming, we synthesize a best-effort preview
     * by stitching together the hunk lines (- for before, + for after) — this
     * does NOT represent the full file but renders a readable diff until the
     * server returns the real oldContents/newContents post-apply.
     */
    before: string;
    after: string;
    complete: boolean;
}

/**
 * Tolerant, streaming-safe parser for the V4A patch envelope emitted by the
 * `apply_patch` tool. Unlike the server parser (which errors on anything
 * malformed so the model gets a useful signal), this one accepts truncated
 * input and stops gracefully at whatever it has seen so far. The output is a
 * list of per-file preview diffs the `ApplyPatchBlock` renders through
 * `PierreDiff`.
 */
function parsePatchForPreview(raw: string): ParsedPatchFile[] {
    if (!raw) return [];
    let text = raw.replace(/^\uFEFF/, "");
    text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

    const lines = text.split("\n");
    const files: ParsedPatchFile[] = [];

    const ADD = /^\*\*\*\s*Add File:\s*(.+?)\s*$/;
    const DEL = /^\*\*\*\s*Delete File:\s*(.+?)\s*$/;
    const UPD = /^\*\*\*\s*Update File:\s*(.+?)\s*$/;
    const MOV = /^\*\*\*\s*Move to:\s*(.+?)\s*$/;
    const END = /^\s*\*\*\*\s*End Patch\s*$/;
    const BEG = /^\s*\*\*\*\s*Begin Patch\s*$/;
    const EOF = /^\*\*\*\s*End of File\s*$/;
    const ANCH = /^@@/;
    const isSection = (l: string) =>
        ADD.test(l) || DEL.test(l) || UPD.test(l) || END.test(l);

    let inPatch = false;
    let i = 0;
    while (i < lines.length) {
        const line = lines[i]!;
        if (BEG.test(line)) {
            inPatch = true;
            i++;
            continue;
        }
        if (!inPatch) {
            i++;
            continue;
        }
        if (END.test(line)) break;

        let m: RegExpMatchArray | null;

        if ((m = line.match(ADD))) {
            const path = m[1]!.trim();
            const body: string[] = [];
            i++;
            while (i < lines.length && !isSection(lines[i]!)) {
                const cur = lines[i]!;
                if (EOF.test(cur)) {
                    i++;
                    continue;
                }
                if (cur.startsWith("+")) body.push(cur.slice(1));
                else if (cur.length === 0) body.push("");
                else break; // malformed mid-stream; stop this file
                i++;
            }
            files.push({
                op: "add",
                path,
                before: "",
                after: body.join("\n"),
                complete: i < lines.length && isSection(lines[i]!)
            });
            continue;
        }

        if ((m = line.match(DEL))) {
            files.push({
                op: "delete",
                path: m[1]!.trim(),
                before: "",
                after: "",
                complete: true
            });
            i++;
            continue;
        }

        if ((m = line.match(UPD))) {
            const path = m[1]!.trim();
            let moveTo: string | undefined;
            i++;
            if (i < lines.length) {
                const mv = lines[i]!.match(MOV);
                if (mv) {
                    moveTo = mv[1]!.trim();
                    i++;
                }
            }
            const beforeLines: string[] = [];
            const afterLines: string[] = [];
            while (i < lines.length && !isSection(lines[i]!)) {
                const cur = lines[i]!;
                if (EOF.test(cur)) {
                    i++;
                    continue;
                }
                if (ANCH.test(cur)) {
                    // Emit the anchor as a context-style hint so the diff view
                    // at least shows where the hunk lives.
                    beforeLines.push(cur);
                    afterLines.push(cur);
                    i++;
                    continue;
                }
                if (cur.length === 0) {
                    beforeLines.push("");
                    afterLines.push("");
                    i++;
                    continue;
                }
                const head = cur[0]!;
                const rest = cur.slice(1);
                if (head === " ") {
                    beforeLines.push(rest);
                    afterLines.push(rest);
                } else if (head === "-") {
                    beforeLines.push(rest);
                } else if (head === "+") {
                    afterLines.push(rest);
                } else {
                    // Unexpected mid-stream; break out of this file.
                    break;
                }
                i++;
            }
            files.push({
                op: moveTo ? "rename" : "update",
                path,
                newPath: moveTo,
                before: beforeLines.join("\n"),
                after: afterLines.join("\n"),
                complete: i < lines.length && isSection(lines[i]!)
            });
            continue;
        }

        i++;
    }

    return files;
}

const APPLY_PATCH_OP_LABEL: Record<ApplyPatchOp, string> = {
    add: "add",
    update: "edit",
    delete: "delete",
    rename: "rename"
};

function formatApplyPatchDetail(
    output: ApplyPatchOutputShape | undefined,
    previewFiles: ParsedPatchFile[]
): string | undefined {
    const summary = output?.summary;
    const changes = output?.changes;

    if (Array.isArray(changes) && changes.length > 0) {
        const filesChanged = summary?.filesChanged ?? changes.length;
        const added = summary?.linesAdded ?? 0;
        const removed = summary?.linesRemoved ?? 0;
        const fileWord = `${filesChanged} file${filesChanged === 1 ? "" : "s"}`;
        if (added > 0 || removed > 0) {
            return `${fileWord} · +${added} −${removed}`;
        }
        return fileWord;
    }

    if (previewFiles.length > 0) {
        const fileWord = `${previewFiles.length} file${previewFiles.length === 1 ? "" : "s"}`;
        return fileWord;
    }

    return undefined;
}

export function ApplyPatchBlock({
    invocation
}: {
    invocation: ToolInvocation;
}) {
    const paneWorkspaceId = usePaneWorkspaceId();
    const workspacePath = useWorkspaceStore((state) => {
        const target = state.workspaces.find((w) => w.id === paneWorkspaceId);
        return target?.path ?? null;
    });

    const input = isRecord(invocation.input)
        ? (invocation.input as ApplyPatchInputShape)
        : undefined;
    const output = isRecord(invocation.output)
        ? (invocation.output as ApplyPatchOutputShape)
        : undefined;
    const streaming = invocation.input_streaming === true;
    const partialFields = streaming
        ? extractPartialTopLevelStrings(invocation.partial_input_text ?? "")
        : {};

    const finalInput =
        typeof input?.input === "string" ? input.input : undefined;
    const partialInput = partialFields.input?.value ?? "";
    const patchSource = finalInput ?? partialInput;

    // Prefer server-returned changes (authoritative full-file diffs). Fall
    // back to client-parsed preview (best-effort hunk view) while streaming
    // or if the tool errored before we had final results.
    const serverChanges = Array.isArray(output?.changes)
        ? output!.changes!
        : [];
    const previewFiles =
        serverChanges.length === 0 && patchSource.length > 0
            ? parsePatchForPreview(patchSource)
            : [];

    const detail = formatApplyPatchDetail(output, previewFiles);
    const hasAny = serverChanges.length > 0 || previewFiles.length > 0;

    return (
        <ToolBlock
            icon={<GitDiffIcon className="size-3.5" weight="bold" />}
            pendingLabel={streaming ? "Streaming patch" : "Applying patch"}
            successLabel="Applied patch"
            errorLabel="Patch failed"
            deniedLabel="Patch denied"
            detail={detail}
            error={invocation.error}
            status={invocation.status}
            autoOpen
            autoClose
            bareChildren
        >
            {invocation.error ? (
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-red-200">
                    {invocation.error}
                </p>
            ) : serverChanges.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                    {serverChanges.map((c, idx) => {
                        const displayPath =
                            formatReadPath(
                                c.relativePath ?? c.path,
                                c.path,
                                workspacePath
                            ) ??
                            c.relativePath ??
                            c.path ??
                            "";
                        const newDisplayPath =
                            c.newPath || c.newRelativePath
                                ? (formatReadPath(
                                      c.newRelativePath ?? c.newPath,
                                      c.newPath,
                                      workspacePath
                                  ) ??
                                  c.newRelativePath ??
                                  c.newPath ??
                                  "")
                                : "";
                        const headerPath =
                            c.op === "rename" && newDisplayPath
                                ? `${displayPath} → ${newDisplayPath}`
                                : displayPath;
                        return (
                            <div
                                key={`${displayPath}-${idx}`}
                                className="flex flex-col gap-1"
                            >
                                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-dark-300">
                                    <span className="rounded bg-dark-800 px-1.5 py-0.5 font-medium text-dark-200">
                                        {APPLY_PATCH_OP_LABEL[c.op ?? "update"]}
                                    </span>
                                    {typeof c.linesAdded === "number" &&
                                        c.linesAdded > 0 && (
                                            <span className="text-emerald-400 normal-case">
                                                +{c.linesAdded}
                                            </span>
                                        )}
                                    {typeof c.linesRemoved === "number" &&
                                        c.linesRemoved > 0 && (
                                            <span className="text-red-400 normal-case">
                                                −{c.linesRemoved}
                                            </span>
                                        )}
                                </div>
                                <PierreDiff
                                    path={headerPath}
                                    oldContents={c.oldContents ?? ""}
                                    newContents={c.newContents ?? ""}
                                />
                            </div>
                        );
                    })}
                </div>
            ) : previewFiles.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                    {previewFiles.map((f, idx) => {
                        const displayPath =
                            formatReadPath(f.path, f.path, workspacePath) ??
                            f.path;
                        const newDisplayPath = f.newPath
                            ? (formatReadPath(
                                  f.newPath,
                                  f.newPath,
                                  workspacePath
                              ) ?? f.newPath)
                            : "";
                        const headerPath =
                            f.op === "rename" && newDisplayPath
                                ? `${displayPath} → ${newDisplayPath}`
                                : displayPath;
                        return (
                            <div
                                key={`${f.path}-${idx}`}
                                className="flex flex-col gap-1"
                            >
                                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-dark-300">
                                    <span className="rounded bg-dark-800 px-1.5 py-0.5 font-medium text-dark-200">
                                        {APPLY_PATCH_OP_LABEL[f.op]}
                                    </span>
                                    {!f.complete && (
                                        <span className="normal-case text-dark-400 italic">
                                            streaming…
                                        </span>
                                    )}
                                </div>
                                {f.op === "delete" ? (
                                    <p className="px-1 text-[11px] italic text-dark-300">
                                        Deleting file.
                                    </p>
                                ) : (
                                    <PierreDiff
                                        path={headerPath}
                                        oldContents={f.before}
                                        newContents={f.after}
                                    />
                                )}
                            </div>
                        );
                    })}
                </div>
            ) : streaming ? (
                <p className="px-1 py-1 text-[11px] italic text-dark-400">
                    Streaming patch…
                </p>
            ) : !hasAny ? (
                <p className="px-1 py-1 text-[11px] italic text-dark-400">
                    No changes applied.
                </p>
            ) : null}
            {!invocation.error && serverChanges.length > 0 && (
                <PostEditDiagnostics output={output} />
            )}
        </ToolBlock>
    );
}
