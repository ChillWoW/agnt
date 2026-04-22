import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { logger } from "../../../lib/logger";
import {
    MAX_OUTPUT_BYTES,
    buildHeaderFields,
    openShellLog,
    shellLogPath,
    trimOutputBuffer,
    type ShellLogHandle
} from "./shell.logs";
import {
    emitShellLifecycle,
    emitShellProgress,
    listShellJobsForConversation,
    registerShellJob,
    scheduleJobRetention
} from "./shell.registry";
import type { ShellJob, ShellState, ShellStream } from "./shell.types";

/** Header auto-refresh cadence. */
const HEADER_REFRESH_MS = 5_000;

// ─── Interpreter selection ────────────────────────────────────────────────────

interface InterpreterSpec {
    bin: string;
    args(command: string): readonly string[];
}

function pickInterpreter(): InterpreterSpec {
    if (process.platform === "win32") {
        const fromEnv = process.env.AGNT_SHELL?.trim();
        const bin =
            fromEnv && fromEnv.length > 0 ? fromEnv : "powershell.exe";
        return {
            bin,
            args: (command) => [
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                command
            ]
        };
    }

    const fromEnv = process.env.AGNT_SHELL?.trim();
    const bin = fromEnv && fromEnv.length > 0 ? fromEnv : "bash";
    return {
        bin,
        args: (command) => ["-c", command]
    };
}

// ─── Kill helpers ─────────────────────────────────────────────────────────────

function killWindowsTree(pid: number): void {
    try {
        const killer = spawn("taskkill", ["/T", "/F", "/PID", String(pid)], {
            stdio: "ignore",
            windowsHide: true
        });
        killer.on("error", (error) => {
            logger.error("[shell] taskkill failed", { pid }, error);
        });
    } catch (error) {
        logger.error("[shell] taskkill spawn threw", { pid }, error);
    }
}

function killPosixTree(pid: number): void {
    try {
        // Negative pid addresses the process group (spawn was detached).
        process.kill(-pid, "SIGTERM");
    } catch {
        try {
            process.kill(pid, "SIGTERM");
        } catch (error) {
            logger.error("[shell] SIGTERM failed", { pid }, error);
        }
    }
    // Escalate to SIGKILL after a short grace period if still alive.
    setTimeout(() => {
        try {
            process.kill(-pid, "SIGKILL");
        } catch {
            try {
                process.kill(pid, "SIGKILL");
            } catch {
                // probably already gone
            }
        }
    }, 2_000).unref?.();
}

export function killShellJob(job: ShellJob): void {
    if (job.pid === null) return;
    if (job.state === "completed" || job.state === "killed") return;
    if (process.platform === "win32") {
        killWindowsTree(job.pid);
    } else {
        killPosixTree(job.pid);
    }
}

/** Kill every foreground shell for a conversation. Background ones survive. */
export function killForegroundForConversation(conversationId: string): number {
    let killed = 0;
    for (const job of listShellJobsForConversation(conversationId)) {
        if (job.state !== "running_foreground") continue;
        killShellJob(job);
        killed += 1;
    }
    if (killed > 0) {
        logger.log("[shell] killed foreground jobs on abort", {
            conversationId,
            killed
        });
    }
    return killed;
}

// ─── Spawn + streaming ────────────────────────────────────────────────────────

export interface SpawnShellJobInit {
    id: string;
    conversation_id: string;
    workspace_id: string;
    message_id: string;
    command: string;
    description: string;
    cwd: string;
    env?: NodeJS.ProcessEnv;
}

export interface SpawnedShellJob {
    job: ShellJob;
}

/**
 * Spawn a new shell child, wire up stdout/stderr → registry progress events,
 * maintain the on-disk log file (including periodic header refresh), and
 * return the `ShellJob` handle.
 *
 * The returned `job.done` promise resolves once the child has fully exited
 * and the log file has been finalized.
 */
export function spawnShellJob(init: SpawnShellJobInit): ShellJob {
    const interpreter = pickInterpreter();
    const shell_args = interpreter.args(init.command);
    const started_at = new Date().toISOString();
    const log_path = shellLogPath(init.workspace_id, init.id);

    const job: ShellJob = {
        id: init.id,
        task_id: init.id,
        conversation_id: init.conversation_id,
        workspace_id: init.workspace_id,
        message_id: init.message_id,
        pid: null,
        command: init.command,
        description: init.description,
        cwd: init.cwd,
        shell_bin: interpreter.bin,
        shell_args,
        started_at,
        ended_at: null,
        exit_code: null,
        state: "running_foreground",
        output: "",
        output_truncated: false,
        log_path,
        done: Promise.resolve()
    };

    registerShellJob(job);

    const log = openShellLog(log_path, buildHeaderFields(job));

    let child: ChildProcessByStdio<Writable | null, Readable, Readable> | null =
        null;
    let spawnError: Error | null = null;

    try {
        child = spawn(interpreter.bin, shell_args, {
            cwd: init.cwd,
            env: init.env ?? process.env,
            windowsHide: true,
            // Detach on POSIX so kill -pid hits the whole process group.
            detached: process.platform !== "win32",
            stdio: ["ignore", "pipe", "pipe"]
        }) as ChildProcessByStdio<null, Readable, Readable>;
    } catch (error) {
        spawnError = error instanceof Error ? error : new Error(String(error));
    }

    if (spawnError || !child) {
        return finalizeSpawnFailure(job, log, spawnError);
    }

    job.pid = child.pid ?? null;

    const refreshTimer = setInterval(() => {
        if (job.state === "completed" || job.state === "killed") return;
        log.refreshHeader(buildHeaderFields(job));
    }, HEADER_REFRESH_MS);
    refreshTimer.unref?.();

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    const onChunk = (stream: ShellStream) => (data: string) => {
        if (data.length === 0) return;
        const at = new Date().toISOString();
        const trimmed = trimOutputBuffer(job.output, data, job.output_truncated);
        job.output = trimmed.output;
        job.output_truncated = trimmed.truncated;

        log.appendChunk(stream, data);

        emitShellProgress({
            id: job.id,
            task_id: job.task_id,
            conversation_id: job.conversation_id,
            workspace_id: job.workspace_id,
            message_id: job.message_id,
            stream,
            chunk: data,
            at
        });
    };

    child.stdout.on("data", onChunk("stdout"));
    child.stderr.on("data", onChunk("stderr"));

    const done = new Promise<void>((resolve) => {
        const finish = (
            exitCode: number | null,
            finalState: ShellState
        ): void => {
            if (job.state === "completed" || job.state === "killed") {
                resolve();
                return;
            }
            clearInterval(refreshTimer);
            job.state = finalState;
            job.exit_code = exitCode;
            job.ended_at = new Date().toISOString();
            const elapsedMs =
                new Date(job.ended_at).getTime() -
                new Date(job.started_at).getTime();
            log.finalize({
                exitCode,
                elapsedMs: Math.max(0, elapsedMs),
                state: finalState
            });
            emitShellLifecycle({
                type: finalState === "killed" ? "killed" : "exit",
                id: job.id,
                task_id: job.task_id,
                conversation_id: job.conversation_id,
                workspace_id: job.workspace_id,
                message_id: job.message_id,
                state: finalState,
                exit_code: exitCode,
                ended_at: job.ended_at
            });
            scheduleJobRetention(job.id);
            resolve();
        };

        child.on("error", (error) => {
            logger.error(
                "[shell] child process error",
                { task_id: job.id, pid: job.pid },
                error
            );
            const message = error instanceof Error ? error.message : String(error);
            const note = `\n[shell] child error: ${message}\n`;
            const trimmed = trimOutputBuffer(job.output, note, job.output_truncated);
            job.output = trimmed.output;
            job.output_truncated = trimmed.truncated;
            log.appendChunk("stderr", note);
            emitShellProgress({
                id: job.id,
                task_id: job.task_id,
                conversation_id: job.conversation_id,
                workspace_id: job.workspace_id,
                message_id: job.message_id,
                stream: "stderr",
                chunk: note,
                at: new Date().toISOString()
            });
            finish(null, "killed");
        });

        child.on("close", (code, signal) => {
            if (signal && code === null) {
                // Killed by a signal — treat as killed unless we already flipped.
                finish(null, "killed");
                return;
            }
            finish(code ?? null, "completed");
        });
    });

    // The done promise needs to sit on the job object so callers can await it.
    // We assign it after the constructor (the placeholder resolved promise
    // exists only because TS requires a value up-front).
    job.done = done;

    return job;
}

function finalizeSpawnFailure(
    job: ShellJob,
    log: ShellLogHandle,
    error: Error | null
): ShellJob {
    const message = error ? error.message : "Failed to spawn shell";
    const note = `[shell] spawn failed: ${message}\n`;
    job.output = note;
    job.output_truncated = false;
    log.appendChunk("stderr", note);
    job.state = "killed";
    job.exit_code = null;
    job.ended_at = new Date().toISOString();
    log.finalize({
        exitCode: null,
        elapsedMs: 0,
        state: "killed"
    });
    emitShellProgress({
        id: job.id,
        task_id: job.task_id,
        conversation_id: job.conversation_id,
        workspace_id: job.workspace_id,
        message_id: job.message_id,
        stream: "stderr",
        chunk: note,
        at: job.ended_at
    });
    emitShellLifecycle({
        type: "killed",
        id: job.id,
        task_id: job.task_id,
        conversation_id: job.conversation_id,
        workspace_id: job.workspace_id,
        message_id: job.message_id,
        state: "killed",
        exit_code: null,
        ended_at: job.ended_at
    });
    scheduleJobRetention(job.id);
    job.done = Promise.resolve();
    return job;
}

/** Flip a running foreground job into background mode. Idempotent. */
export function backgroundShellJob(job: ShellJob): void {
    if (job.state !== "running_foreground") return;
    job.state = "running_background";
    emitShellLifecycle({
        type: "backgrounded",
        id: job.id,
        task_id: job.task_id,
        conversation_id: job.conversation_id,
        workspace_id: job.workspace_id,
        message_id: job.message_id,
        state: job.state,
        exit_code: null,
        ended_at: null
    });
}

export { MAX_OUTPUT_BYTES };
