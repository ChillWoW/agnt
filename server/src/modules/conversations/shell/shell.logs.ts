import {
    closeSync,
    mkdirSync,
    openSync,
    writeSync,
    type PathLike
} from "node:fs";
import { join } from "node:path";
import { getHomePath } from "../../../lib/homedir";
import { logger } from "../../../lib/logger";
import type { ShellJob, ShellStream } from "./shell.types";

/**
 * Header is a fixed-width block at the top of every shell log file. We
 * rewrite it in-place (via positional fs.write) every ~5s so `running_for_ms`
 * stays fresh while the job is alive. Padding keeps the total byte length
 * identical on every rewrite so we don't accidentally shift the body.
 */

const HEADER_PAD = 24;
const FOOTER_PAD = 24;

/** Byte-length budget kept in memory; extra bytes still land in the log file. */
export const MAX_OUTPUT_BYTES = 1_048_576; // 1 MiB

function padRight(value: string, width: number): string {
    return value.length >= width ? value : `${value}${" ".repeat(width - value.length)}`;
}

function escapeForHeader(value: string): string {
    return value.replace(/\r?\n/g, " ").slice(0, 4000);
}

export function shellLogsDir(workspaceId: string): string {
    const dir = getHomePath("workspaces", workspaceId, "shell-logs");
    try {
        mkdirSync(dir, { recursive: true });
    } catch (error) {
        logger.error("[shell] failed to ensure shell-logs dir", { dir }, error);
    }
    return dir;
}

export function shellLogPath(workspaceId: string, taskId: string): string {
    return join(shellLogsDir(workspaceId), `${taskId}.txt`);
}

interface HeaderFields {
    pid: number | null;
    cwd: string;
    shell: string;
    command: string;
    description: string;
    started_at: string;
    running_for_ms: number;
    task_id: string;
}

/**
 * Render the fixed-width header. Every `xxx:` value line is right-padded so
 * the whole header footprint stays byte-identical between rewrites.
 */
function renderHeader(fields: HeaderFields): string {
    const lines: string[] = [];
    lines.push("---");
    lines.push(`task_id: ${padRight(fields.task_id, HEADER_PAD)}`);
    lines.push(`pid: ${padRight(fields.pid === null ? "null" : String(fields.pid), HEADER_PAD)}`);
    lines.push(`shell: ${padRight(fields.shell, HEADER_PAD)}`);
    lines.push(`cwd: ${escapeForHeader(fields.cwd)}`);
    lines.push(`command: ${escapeForHeader(fields.command)}`);
    lines.push(`description: ${escapeForHeader(fields.description)}`);
    lines.push(`started_at: ${padRight(fields.started_at, HEADER_PAD)}`);
    lines.push(`running_for_ms: ${padRight(String(fields.running_for_ms), HEADER_PAD)}`);
    lines.push("---");
    lines.push("");
    return lines.join("\n");
}

function renderFooter(exitCode: number | null, elapsedMs: number, state: string): string {
    return (
        "\n---\n" +
        `exit_code: ${padRight(exitCode === null ? "null" : String(exitCode), FOOTER_PAD)}\n` +
        `elapsed_ms: ${padRight(String(elapsedMs), FOOTER_PAD)}\n` +
        `state: ${padRight(state, FOOTER_PAD)}\n` +
        "---\n"
    );
}

export interface ShellLogHandle {
    path: string;
    headerSize: number;
    /** Write a body chunk (stdout or stderr). */
    appendChunk(stream: ShellStream, chunk: string): void;
    /** Rewrite the header in-place (refresh running_for_ms / pid). */
    refreshHeader(fields: HeaderFields): void;
    /** Append the exit footer and close the handle. Idempotent. */
    finalize(args: {
        exitCode: number | null;
        elapsedMs: number;
        state: string;
    }): void;
    /** Force-close the handle without writing a footer (used on server crash paths). */
    closeQuietly(): void;
}

/**
 * Open a log file for a new shell job and write the initial header. The
 * returned handle keeps the fd alive for positional header rewrites and
 * streaming body appends.
 */
export function openShellLog(
    path: PathLike,
    fields: HeaderFields
): ShellLogHandle {
    let fd: number | null = null;
    try {
        fd = openSync(path, "w+");
    } catch (error) {
        logger.error("[shell] failed to open log file", { path }, error);
        return makeNoopHandle(String(path));
    }

    let headerText = renderHeader(fields);
    let headerSize = Buffer.byteLength(headerText, "utf8");
    try {
        writeSync(fd, headerText, 0, "utf8");
    } catch (error) {
        logger.error("[shell] failed to write header", { path }, error);
    }

    let closed = false;

    function writeAt(buffer: Buffer, position: number): void {
        if (closed || fd === null) return;
        try {
            writeSync(fd, buffer, 0, buffer.byteLength, position);
        } catch (error) {
            logger.error("[shell] writeSync failed", { path }, error);
        }
    }

    function appendEnd(text: string): void {
        if (closed || fd === null) return;
        try {
            // -1 position appends at the current end of file for w+ descriptors.
            writeSync(fd, text, null, "utf8");
        } catch (error) {
            logger.error("[shell] append failed", { path }, error);
        }
    }

    function refreshHeader(next: HeaderFields): void {
        if (closed || fd === null) return;
        const rendered = renderHeader(next);
        const rendered_bytes = Buffer.byteLength(rendered, "utf8");
        if (rendered_bytes === headerSize) {
            writeAt(Buffer.from(rendered, "utf8"), 0);
            return;
        }
        // Width drift (cwd/command lengths changed somehow) — skip refresh to
        // avoid clobbering body bytes. Header stays at last consistent value.
        logger.log("[shell] header width drift — skipping refresh", {
            path,
            prev: headerSize,
            next: rendered_bytes
        });
        headerText = rendered;
    }

    function appendChunk(stream: ShellStream, chunk: string): void {
        if (chunk.length === 0) return;
        // Tag stderr visually in the log so the file is useful standalone.
        if (stream === "stderr") {
            const lines = chunk.split(/(?<=\n)/);
            const tagged = lines
                .map((line) =>
                    line.length === 0 ? line : `[stderr] ${line}`
                )
                .join("");
            appendEnd(tagged);
        } else {
            appendEnd(chunk);
        }
    }

    function finalize({
        exitCode,
        elapsedMs,
        state
    }: {
        exitCode: number | null;
        elapsedMs: number;
        state: string;
    }): void {
        if (closed) return;
        appendEnd(renderFooter(exitCode, elapsedMs, state));
        closed = true;
        if (fd !== null) {
            try {
                closeSync(fd);
            } catch {
                // ignore
            }
            fd = null;
        }
    }

    function closeQuietly(): void {
        if (closed) return;
        closed = true;
        if (fd !== null) {
            try {
                closeSync(fd);
            } catch {
                // ignore
            }
            fd = null;
        }
    }

    return {
        path: String(path),
        headerSize,
        appendChunk,
        refreshHeader,
        finalize,
        closeQuietly
    };
}

/**
 * Trim an in-memory output buffer to stay under the byte budget. Returns the
 * (possibly) trimmed string and whether we dropped bytes. Trimming keeps the
 * tail — the model cares about most-recent output, not the beginning.
 */
export function trimOutputBuffer(
    existing: string,
    incoming: string,
    alreadyTruncated: boolean
): { output: string; truncated: boolean } {
    const combined = existing + incoming;
    const byteLength = Buffer.byteLength(combined, "utf8");
    if (byteLength <= MAX_OUTPUT_BYTES) {
        return { output: combined, truncated: alreadyTruncated };
    }
    const slice = Buffer.from(combined, "utf8")
        .subarray(byteLength - MAX_OUTPUT_BYTES)
        .toString("utf8");
    const marker = alreadyTruncated
        ? ""
        : "[... in-memory buffer truncated; see log_path for full output ...]\n";
    return { output: `${marker}${slice}`, truncated: true };
}

/** Keep a minimal header descriptor the registry/runtime reuses. */
export function buildHeaderFields(job: ShellJob): HeaderFields {
    const runningForMs = job.ended_at
        ? new Date(job.ended_at).getTime() - new Date(job.started_at).getTime()
        : Date.now() - new Date(job.started_at).getTime();
    return {
        task_id: job.task_id,
        pid: job.pid,
        cwd: job.cwd,
        shell: job.shell_bin,
        command: job.command,
        description: job.description,
        started_at: job.started_at,
        running_for_ms: Math.max(0, runningForMs)
    };
}

function makeNoopHandle(path: string): ShellLogHandle {
    return {
        path,
        headerSize: 0,
        appendChunk() {},
        refreshHeader() {},
        finalize() {},
        closeQuietly() {}
    };
}
