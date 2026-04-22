/**
 * Shared types for the shell-tool runtime: job descriptors, stream events,
 * and the lifecycle state machine. `task_id` is treated as the canonical
 * identity of a shell job and is 1:1 with a `tool_invocations.id` row.
 */

export type ShellStream = "stdout" | "stderr";

export type ShellState =
    /** Process is alive and the caller (shell tool.execute) is still awaiting it. */
    | "running_foreground"
    /** Process is alive but has been detached for later polling via await_shell. */
    | "running_background"
    /** Process exited normally (exit_code may still be non-zero). */
    | "completed"
    /** Process was killed by the server (abort, kill helper, timeout-on-background-only). */
    | "killed";

export interface ShellChunk {
    stream: ShellStream;
    chunk: string;
    at: string;
}

export interface ShellJob {
    /** Canonical id: equal to the tool_invocations row id. */
    id: string;
    /** Alias of `id`, exposed to the model as `task_id`. */
    task_id: string;
    conversation_id: string;
    workspace_id: string;
    message_id: string;
    /** OS process id once the child has spawned; null before spawn / after a crash. */
    pid: number | null;
    command: string;
    description: string;
    cwd: string;
    shell_bin: string;
    shell_args: readonly string[];
    started_at: string;
    /** ISO timestamp the process exited or was killed, or null while alive. */
    ended_at: string | null;
    exit_code: number | null;
    state: ShellState;
    /** Rolling in-memory aggregated output, capped at MAX_OUTPUT_BYTES. */
    output: string;
    /** True once we've dropped bytes from the in-memory buffer (log file still has them). */
    output_truncated: boolean;
    log_path: string;
    /** Resolves once the process exits or is killed. */
    done: Promise<void>;
}

/** Event emitted to per-conversation listeners for every new stdout/stderr chunk. */
export interface ShellProgressEvent {
    /** tool_invocation id (same as task_id). */
    id: string;
    task_id: string;
    conversation_id: string;
    workspace_id: string;
    message_id: string;
    stream: ShellStream;
    chunk: string;
    at: string;
}

/** Event emitted when a job terminates or is moved between foreground/background. */
export interface ShellLifecycleEvent {
    type: "backgrounded" | "exit" | "killed";
    id: string;
    task_id: string;
    conversation_id: string;
    workspace_id: string;
    message_id: string;
    state: ShellState;
    exit_code: number | null;
    ended_at: string | null;
}

/** Snapshot exposed to callers (tool return shape, DB partial-output hydration). */
export interface ShellSnapshot {
    task_id: string;
    state: ShellState;
    pid: number | null;
    command: string;
    description: string;
    cwd: string;
    started_at: string;
    ended_at: string | null;
    exit_code: number | null;
    running_for_ms: number;
    output: string;
    output_truncated: boolean;
    log_path: string;
}
