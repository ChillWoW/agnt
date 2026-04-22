import { z } from "zod";
import { getWorkspaceDb } from "../../../lib/db";
import { logger } from "../../../lib/logger";
import {
    backgroundShellJob,
    killShellJob,
    snapshotShellJob,
    spawnShellJob,
    subscribeToJobProgress
} from "../shell";
import { resolveToolInvocationContext } from "../shell/tool-context";
import { resolveWorkspacePath } from "./workspace-path";
import type { ShellSnapshot } from "../shell";
import type {
    ToolDefinition,
    ToolExecuteContext,
    ToolModelOutput
} from "./types";

// ─── Tuning ───────────────────────────────────────────────────────────────────

const DEFAULT_BLOCK_MS = 30_000;
const MAX_BLOCK_MS = 600_000;
/** Periodic DB flush cadence while a shell job streams. */
const DB_FLUSH_MS = 500;
/** Or flush sooner if we've buffered this much new output since last flush. */
const DB_FLUSH_BYTES = 4 * 1024;
/** Cap on inline output returned to the model (chars, not bytes). */
const MAX_INLINE_OUTPUT_CHARS = 200_000;

// ─── Schema ───────────────────────────────────────────────────────────────────

export const shellInputSchema = z.object({
    command: z
        .string()
        .min(1)
        .describe(
            "Shell command to execute. Runs through the system shell (PowerShell on Windows, bash on POSIX). " +
                "Use '&&' / ';' to chain commands; quote paths with spaces."
        ),
    description: z
        .string()
        .min(1)
        .describe(
            "Short (5-10 word) description of what this command does, shown to the user in the UI."
        ),
    working_directory: z
        .string()
        .optional()
        .describe(
            "Workspace-relative or absolute-inside-workspace directory to run in. Defaults to the workspace root."
        ),
    block_until_ms: z
        .number()
        .int()
        .min(0)
        .max(MAX_BLOCK_MS)
        .optional()
        .describe(
            `How long to wait (ms) for the command to complete before moving it to the background and returning. ` +
                `Defaults to ${DEFAULT_BLOCK_MS}. Set to 0 to detach immediately (good for dev servers / watchers). ` +
                `Hard cap ${MAX_BLOCK_MS}.`
        )
});

export type ShellInput = z.infer<typeof shellInputSchema>;

// ─── Output shapes ────────────────────────────────────────────────────────────

export interface ShellCompletedOutput extends ShellSnapshot {
    status: "completed";
}

export interface ShellBackgroundedOutput extends ShellSnapshot {
    status: "backgrounded";
}

export interface ShellKilledOutput extends ShellSnapshot {
    status: "killed";
}

export type ShellOutput =
    | ShellCompletedOutput
    | ShellBackgroundedOutput
    | ShellKilledOutput;

// ─── Factory ──────────────────────────────────────────────────────────────────

export interface ShellToolExecuteContext {
    workspacePath?: string;
    /** Fallback identifiers used when the tool is wired outside a live stream. */
    conversationId?: string;
    workspaceId?: string;
    getAssistantMessageId?: () => string;
}

const TOOL_DESCRIPTION =
    "Execute shell commands (PowerShell on Windows, bash on POSIX). " +
        "Supports foregrounding with a timeout OR backgrounding via `block_until_ms: 0`. " +
        "Output streams live to the UI. " +
        "If the command finishes before `block_until_ms` elapses it returns `{ status: 'completed', exit_code, output, ... }`. " +
        "Otherwise it moves the job to the background and returns `{ status: 'backgrounded', task_id, ... }` — use `await_shell` with that task_id to re-attach, poll, or wait for completion. " +
        "Every job's full stdout+stderr is persisted to `log_path`, readable later with `read_file`.";

function truncateForModel(text: string): string {
    if (text.length <= MAX_INLINE_OUTPUT_CHARS) return text;
    const keep = MAX_INLINE_OUTPUT_CHARS - 200;
    return (
        text.slice(0, keep) +
        `\n[... truncated ${text.length - keep} chars; read full output from log_path ...]`
    );
}

function makeExecuteShell(ctx: ShellToolExecuteContext) {
    return async function executeShell(
        input: ShellInput,
        toolCtx?: ToolExecuteContext
    ): Promise<ShellOutput> {
        const invocationCtx = resolveToolInvocationContext(
            toolCtx?.toolCallId
        );

        const invocationId = invocationCtx?.invocationId ?? crypto.randomUUID();
        const conversationId =
            invocationCtx?.conversationId ?? ctx.conversationId ?? "";
        const workspaceId =
            invocationCtx?.workspaceId ?? ctx.workspaceId ?? "";
        const messageId =
            invocationCtx?.messageId ?? ctx.getAssistantMessageId?.() ?? "";

        if (!workspaceId) {
            throw new Error(
                "shell tool requires an active workspace; none was resolved for this invocation."
            );
        }

        const cwd = resolveWorkspacePath(
            input.working_directory,
            ctx.workspacePath,
            "shell"
        ).absolute;

        const blockUntilMs =
            typeof input.block_until_ms === "number"
                ? input.block_until_ms
                : DEFAULT_BLOCK_MS;

        logger.log("[tool:shell] spawning", {
            invocationId,
            conversationId,
            workspaceId,
            cwd,
            blockUntilMs,
            command: input.command.slice(0, 200)
        });

        const job = spawnShellJob({
            id: invocationId,
            conversation_id: conversationId,
            workspace_id: workspaceId,
            message_id: messageId,
            command: input.command,
            description: input.description,
            cwd
        });

        // ── Periodic DB flush of partial output ───────────────────────────────
        const db = workspaceId ? getWorkspaceDb(workspaceId) : null;
        let unflushedBytes = 0;
        let lastFlushAt = 0;

        function flushPartialToDb(force: boolean): void {
            if (!db) return;
            const now = Date.now();
            if (
                !force &&
                unflushedBytes < DB_FLUSH_BYTES &&
                now - lastFlushAt < DB_FLUSH_MS
            ) {
                return;
            }
            const snapshot = snapshotShellJob(job);
            const payload = {
                streaming: job.state === "running_foreground",
                task_id: job.task_id,
                state: job.state,
                pid: job.pid,
                command: job.command,
                description: job.description,
                cwd: job.cwd,
                started_at: job.started_at,
                ended_at: job.ended_at,
                exit_code: job.exit_code,
                running_for_ms: snapshot.running_for_ms,
                partial_output: job.output,
                output_truncated: job.output_truncated,
                log_path: job.log_path
            };
            try {
                db.query(
                    "UPDATE tool_invocations SET output_json = ? WHERE id = ?"
                ).run(JSON.stringify(payload), invocationId);
            } catch (error) {
                logger.error(
                    "[tool:shell] failed to flush partial output",
                    { invocationId },
                    error
                );
            }
            unflushedBytes = 0;
            lastFlushAt = now;
        }

        const flushTimer = setInterval(() => {
            if (
                job.state === "completed" ||
                job.state === "killed" ||
                job.state === "running_background"
            ) {
                return;
            }
            flushPartialToDb(false);
        }, DB_FLUSH_MS);
        // Don't keep Node alive solely for the flush cadence.
        (flushTimer as unknown as { unref?: () => void }).unref?.();

        const unsubscribeProgress = subscribeToJobProgress(job.id, (event) => {
            unflushedBytes += Buffer.byteLength(event.chunk, "utf8");
            if (unflushedBytes >= DB_FLUSH_BYTES) {
                flushPartialToDb(false);
            }
        });

        // ── Abort plumbing ────────────────────────────────────────────────────
        const abortSignal = toolCtx?.abortSignal;
        const onAbort = () => {
            if (job.state === "running_foreground") {
                logger.log("[tool:shell] abort signal received", {
                    invocationId
                });
                killShellJob(job);
            }
        };
        if (abortSignal) {
            if (abortSignal.aborted) onAbort();
            else abortSignal.addEventListener("abort", onAbort, { once: true });
        }

        // ── Foreground vs background decision ────────────────────────────────
        async function waitForDoneOrTimeout(): Promise<"done" | "timeout"> {
            if (blockUntilMs === 0) return "timeout";
            let timer: ReturnType<typeof setTimeout> | null = null;
            const timeoutPromise = new Promise<"timeout">((resolve) => {
                timer = setTimeout(() => resolve("timeout"), blockUntilMs);
                (timer as unknown as { unref?: () => void }).unref?.();
            });
            const donePromise = job.done.then<"done">(() => "done");
            try {
                return await Promise.race([donePromise, timeoutPromise]);
            } finally {
                if (timer) clearTimeout(timer);
            }
        }

        try {
            const outcome = await waitForDoneOrTimeout();

            if (outcome === "done") {
                flushPartialToDb(true);
                const snapshot = snapshotShellJob(job);
                const status: ShellOutput["status"] =
                    job.state === "killed" ? "killed" : "completed";
                logger.log("[tool:shell] foreground finished", {
                    invocationId,
                    status,
                    exit_code: snapshot.exit_code,
                    ms: snapshot.running_for_ms
                });
                return { ...snapshot, status } as ShellOutput;
            }

            // Timeout hit (or block_until_ms was 0): move to background.
            backgroundShellJob(job);
            flushPartialToDb(true);
            const snapshot = snapshotShellJob(job);
            logger.log("[tool:shell] backgrounded", {
                invocationId,
                task_id: snapshot.task_id,
                blockUntilMs
            });
            return { ...snapshot, status: "backgrounded" };
        } finally {
            clearInterval(flushTimer);
            unsubscribeProgress();
            if (abortSignal) abortSignal.removeEventListener("abort", onAbort);
        }
    };
}

// ─── Model output transformer ─────────────────────────────────────────────────

function toModelOutput({
    output
}: {
    input: ShellInput;
    output: ShellOutput;
}): ToolModelOutput {
    const header =
        output.status === "completed"
            ? `Shell completed (exit_code=${output.exit_code}, ${output.running_for_ms}ms, pid=${output.pid ?? "?"}).`
            : output.status === "backgrounded"
              ? `Shell backgrounded (task_id=${output.task_id}, still running after ${output.running_for_ms}ms). Use await_shell to poll.`
              : `Shell killed (task_id=${output.task_id}, after ${output.running_for_ms}ms).`;

    const body = truncateForModel(output.output);
    const trailer =
        output.output_truncated || body !== output.output
            ? `\n(log_path: ${output.log_path} — use read_file to see the full output.)`
            : "";

    return {
        type: "text",
        value: `${header}\n\n${body}${trailer}`
    };
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createShellToolDef(
    ctx: ShellToolExecuteContext = {}
): ToolDefinition<ShellInput, ShellOutput> {
    return {
        name: "shell",
        description: TOOL_DESCRIPTION,
        inputSchema: shellInputSchema,
        execute: makeExecuteShell(ctx),
        toModelOutput
    };
}

export const shellToolDef: ToolDefinition<ShellInput, ShellOutput> =
    createShellToolDef();
