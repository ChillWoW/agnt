import { z } from "zod";
import { getWorkspaceDb } from "../../../lib/db";
import { logger } from "../../../lib/logger";
import {
    forwardShellProgressToConversation,
    getShellJob,
    snapshotShellJob,
    subscribeToJobLifecycle,
    subscribeToJobProgress
} from "../shell";
import { resolveToolInvocationContext } from "../shell/tool-context";
import type { ShellSnapshot } from "../shell";
import type {
    ToolDefinition,
    ToolExecuteContext,
    ToolModelOutput
} from "./types";

const DEFAULT_BLOCK_MS = 30_000;
const MAX_BLOCK_MS = 600_000;
/**
 * Cap on inline `new_output` returned to the model. Kept small — the full
 * job output is always persisted at `snapshot.log_path` and the model can
 * `read_file` it on demand.
 */
const MAX_INLINE_OUTPUT_CHARS = 25_000;
/** Chars kept from the head of the buffer; the rest of the budget is tail. */
const INLINE_HEAD_CHARS = 4_000;

// ─── Schema ───────────────────────────────────────────────────────────────────

export const awaitShellInputSchema = z.object({
    task_id: z
        .string()
        .optional()
        .describe(
            "The id returned by a previous `shell` call that was backgrounded. Omit to just sleep for `block_until_ms` (useful when you want to pause without checking anything)."
        ),
    block_until_ms: z
        .number()
        .int()
        .min(0)
        .max(MAX_BLOCK_MS)
        .optional()
        .describe(
            `Max time (ms) to block before returning. Defaults to ${DEFAULT_BLOCK_MS}. Hard cap ${MAX_BLOCK_MS}.`
        ),
    pattern: z
        .string()
        .optional()
        .describe(
            "JavaScript regex. If provided, the call resolves as soon as new output (since attach) matches the pattern. Matches anywhere in the stream; the regex is compiled with the multiline `m` flag."
        )
});

export type AwaitShellInput = z.infer<typeof awaitShellInputSchema>;

// ─── Output shape ─────────────────────────────────────────────────────────────

export interface AwaitShellOutput {
    status: "completed" | "backgrounded" | "killed" | "sleep" | "not_found";
    task_id: string | null;
    new_output: string;
    snapshot: ShellSnapshot | null;
    elapsed_ms: number;
    pattern_matched: boolean;
    /** True if we returned because `pattern` matched. */
    pattern?: string;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export interface AwaitShellToolContext {
    conversationId?: string;
    workspaceId?: string;
    getAssistantMessageId?: () => string;
}

const TOOL_DESCRIPTION =
    "Poll a backgrounded shell job by task_id. " +
        "Blocks up to `block_until_ms` and resolves when (a) the job exits, (b) `pattern` matches new output produced since the call started, or (c) the timeout elapses. " +
        "Returns `{ status, new_output, snapshot, elapsed_ms, pattern_matched }`. " +
        "If `task_id` is omitted, the tool just sleeps for `block_until_ms` (useful as a plain wait).";

function truncateForModel(text: string): string {
    if (text.length <= MAX_INLINE_OUTPUT_CHARS) return text;
    const head = text.slice(0, INLINE_HEAD_CHARS);
    const tailBudget = MAX_INLINE_OUTPUT_CHARS - INLINE_HEAD_CHARS - 200;
    const tail = text.slice(text.length - tailBudget);
    const dropped = text.length - head.length - tail.length;
    return (
        `${head}\n[... truncated ${dropped} chars from the middle; ` +
        `read full output from log_path ...]\n${tail}`
    );
}

function makeExecuteAwaitShell(ctx: AwaitShellToolContext) {
    return async function executeAwaitShell(
        input: AwaitShellInput,
        toolCtx?: ToolExecuteContext
    ): Promise<AwaitShellOutput> {
        const invocationCtx = resolveToolInvocationContext(
            toolCtx?.toolCallId
        );
        const blockUntilMs =
            typeof input.block_until_ms === "number"
                ? input.block_until_ms
                : DEFAULT_BLOCK_MS;
        const startedAt = Date.now();

        // No task_id → plain sleep. Still respect abort.
        if (!input.task_id) {
            await sleepWithAbort(blockUntilMs, toolCtx?.abortSignal);
            return {
                status: "sleep",
                task_id: null,
                new_output: "",
                snapshot: null,
                elapsed_ms: Date.now() - startedAt,
                pattern_matched: false,
                pattern: input.pattern
            };
        }

        const job = getShellJob(input.task_id);
        if (!job) {
            logger.log("[tool:await_shell] job not found", {
                task_id: input.task_id
            });
            return {
                status: "not_found",
                task_id: input.task_id,
                new_output: "",
                snapshot: null,
                elapsed_ms: Date.now() - startedAt,
                pattern_matched: false,
                pattern: input.pattern
            };
        }

        const awaitInvocationId =
            invocationCtx?.invocationId ?? crypto.randomUUID();
        const conversationId =
            invocationCtx?.conversationId ?? ctx.conversationId ?? job.conversation_id;
        const workspaceId =
            invocationCtx?.workspaceId ?? ctx.workspaceId ?? job.workspace_id;
        const messageId =
            invocationCtx?.messageId ??
            ctx.getAssistantMessageId?.() ??
            job.message_id;

        // Pattern may be invalid regex — reject cleanly.
        let patternRe: RegExp | null = null;
        if (input.pattern && input.pattern.length > 0) {
            try {
                patternRe = new RegExp(input.pattern, "m");
            } catch (error) {
                throw new Error(
                    `await_shell: invalid regex pattern: ${
                        error instanceof Error ? error.message : String(error)
                    }`
                );
            }
        }

        let newOutputBuffer = "";
        let resolved = false;
        let resolveFn: ((value: void) => void) | null = null;
        let patternMatched = false;

        const waiter = new Promise<void>((resolve) => {
            resolveFn = resolve;
        });

        function finish(): void {
            if (resolved) return;
            resolved = true;
            resolveFn?.();
        }

        // Re-emit each target-job chunk under THIS await_shell invocation so
        // the live stream's SSE subscription routes them into this card too.
        //
        // IMPORTANT: we MUST NOT fan this re-emission out to per-job listeners
        // — this very function is subscribed as a per-job listener for
        // `job.task_id`, so `emitShellProgress` with the same task_id would
        // recurse into us, append `progress.chunk` again, and repeat until the
        // JS stack overflows (leaving `newOutputBuffer` bloated with tens of
        // thousands of duplicated chunks that then get piped back into the
        // model's context). `forwardShellProgressToConversation` is SSE-only.
        const unsubscribeProgress = subscribeToJobProgress(
            job.id,
            (progress) => {
                newOutputBuffer += progress.chunk;
                forwardShellProgressToConversation({
                    id: awaitInvocationId,
                    task_id: job.task_id,
                    conversation_id: conversationId,
                    workspace_id: workspaceId,
                    message_id: messageId,
                    stream: progress.stream,
                    chunk: progress.chunk,
                    at: progress.at
                });
                if (patternRe && patternRe.test(newOutputBuffer)) {
                    patternMatched = true;
                    finish();
                }
            }
        );

        const unsubscribeLifecycle = subscribeToJobLifecycle(
            job.id,
            (event) => {
                if (event.type === "exit" || event.type === "killed") {
                    finish();
                }
            }
        );

        // If the job already exited before we subscribed, short-circuit.
        if (
            job.state === "completed" ||
            job.state === "killed"
        ) {
            finish();
        }

        // Periodic partial-output flush to the DB so a refresh mid-poll still
        // shows accumulated new_output on this invocation's card.
        const db = workspaceId ? getWorkspaceDb(workspaceId) : null;
        const flushTimer = setInterval(() => {
            if (!db) return;
            try {
                db.query(
                    "UPDATE tool_invocations SET output_json = ? WHERE id = ?"
                ).run(
                    JSON.stringify({
                        streaming: !resolved,
                        task_id: job.task_id,
                        state: job.state,
                        partial_output: newOutputBuffer,
                        elapsed_ms: Date.now() - startedAt,
                        pattern: input.pattern ?? null
                    }),
                    awaitInvocationId
                );
            } catch (error) {
                logger.error(
                    "[tool:await_shell] flush partial failed",
                    { awaitInvocationId },
                    error
                );
            }
        }, 500);
        (flushTimer as unknown as { unref?: () => void }).unref?.();

        // Abort support.
        const abortSignal = toolCtx?.abortSignal;
        const onAbort = () => finish();
        if (abortSignal) {
            if (abortSignal.aborted) finish();
            else abortSignal.addEventListener("abort", onAbort, { once: true });
        }

        // Timeout.
        let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
        if (blockUntilMs > 0) {
            timeoutHandle = setTimeout(finish, blockUntilMs);
            (timeoutHandle as unknown as { unref?: () => void }).unref?.();
        } else {
            // block_until_ms === 0 and task exists → one-shot poll (no wait).
            finish();
        }

        try {
            await waiter;
        } finally {
            unsubscribeProgress();
            unsubscribeLifecycle();
            clearInterval(flushTimer);
            if (timeoutHandle) clearTimeout(timeoutHandle);
            if (abortSignal)
                abortSignal.removeEventListener("abort", onAbort);
        }

        const snapshot = snapshotShellJob(job);
        const status: AwaitShellOutput["status"] =
            job.state === "completed"
                ? "completed"
                : job.state === "killed"
                  ? "killed"
                  : "backgrounded";

        return {
            status,
            task_id: job.task_id,
            new_output: newOutputBuffer,
            snapshot,
            elapsed_ms: Date.now() - startedAt,
            pattern_matched: patternMatched,
            pattern: input.pattern
        };
    };
}

async function sleepWithAbort(
    ms: number,
    signal?: AbortSignal
): Promise<void> {
    if (ms <= 0) return;
    if (signal?.aborted) return;
    return new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, ms);
        (timer as unknown as { unref?: () => void }).unref?.();
        signal?.addEventListener(
            "abort",
            () => {
                clearTimeout(timer);
                resolve();
            },
            { once: true }
        );
    });
}

// ─── Model output transformer ─────────────────────────────────────────────────

function toModelOutput({
    output
}: {
    input: AwaitShellInput;
    output: AwaitShellOutput;
}): ToolModelOutput {
    if (output.status === "sleep") {
        return {
            type: "text",
            value: `Slept for ${output.elapsed_ms}ms.`
        };
    }

    if (output.status === "not_found") {
        return {
            type: "text",
            value: `await_shell: task_id ${output.task_id} not found (it may have been evicted from the registry after ~5 minutes — read_file its log_path for the final output).`
        };
    }

    const snap = output.snapshot;
    const header =
        output.status === "completed"
            ? `Shell job ${output.task_id} completed (exit_code=${snap?.exit_code ?? "?"}, total_ms=${snap?.running_for_ms ?? "?"}).`
            : output.status === "killed"
              ? `Shell job ${output.task_id} was killed (total_ms=${snap?.running_for_ms ?? "?"}).`
              : `Shell job ${output.task_id} is still running (running_for_ms=${snap?.running_for_ms ?? "?"}). Poll again with await_shell.`;

    const matched = output.pattern_matched
        ? `Pattern ${JSON.stringify(output.pattern ?? "")} matched new output.\n`
        : "";

    const body = truncateForModel(output.new_output);
    const bodyBlock =
        body.length > 0 ? `\nNew output since attach:\n${body}` : "";
    const trailer = snap?.log_path
        ? `\n(log_path: ${snap.log_path})`
        : "";

    return {
        type: "text",
        value: `${header}\n${matched}${bodyBlock}${trailer}`
    };
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createAwaitShellToolDef(
    ctx: AwaitShellToolContext = {}
): ToolDefinition<AwaitShellInput, AwaitShellOutput> {
    return {
        name: "await_shell",
        description: TOOL_DESCRIPTION,
        inputSchema: awaitShellInputSchema,
        execute: makeExecuteAwaitShell(ctx),
        toModelOutput
    };
}

export const awaitShellToolDef: ToolDefinition<
    AwaitShellInput,
    AwaitShellOutput
> = createAwaitShellToolDef();
