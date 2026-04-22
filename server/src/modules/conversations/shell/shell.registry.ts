import { logger } from "../../../lib/logger";
import type {
    ShellJob,
    ShellLifecycleEvent,
    ShellProgressEvent,
    ShellSnapshot
} from "./shell.types";

/**
 * Central in-process registry for running and recently-completed shell jobs.
 *
 * The registry decouples the shell-tool runtime (which produces chunks and
 * lifecycle events) from the streaming layer (which forwards them over SSE)
 * and from `await_shell` (which re-attaches to backgrounded jobs). Every
 * subscription is scoped per-conversation so jobs from conversation A never
 * leak output into conversation B's stream.
 */

type ProgressListener = (event: ShellProgressEvent) => void;
type LifecycleListener = (event: ShellLifecycleEvent) => void;

const jobsById = new Map<string, ShellJob>();

/** Keep completed jobs around briefly so await_shell can still read the final state. */
const RETAIN_COMPLETED_MS = 5 * 60 * 1000;
const retentionTimers = new Map<string, ReturnType<typeof setTimeout>>();

const progressListenersByConversation = new Map<string, Set<ProgressListener>>();
const lifecycleListenersByConversation = new Map<string, Set<LifecycleListener>>();

/** Per-job progress listeners (used by await_shell to observe just one job). */
const progressListenersByJob = new Map<string, Set<ProgressListener>>();
const lifecycleListenersByJob = new Map<string, Set<LifecycleListener>>();

export function registerShellJob(job: ShellJob): void {
    jobsById.set(job.id, job);
}

export function getShellJob(taskId: string): ShellJob | undefined {
    return jobsById.get(taskId);
}

export function listShellJobsForConversation(conversationId: string): ShellJob[] {
    const out: ShellJob[] = [];
    for (const job of jobsById.values()) {
        if (job.conversation_id === conversationId) out.push(job);
    }
    return out;
}

export function snapshotShellJob(job: ShellJob): ShellSnapshot {
    const runningForMs = job.ended_at
        ? new Date(job.ended_at).getTime() - new Date(job.started_at).getTime()
        : Date.now() - new Date(job.started_at).getTime();
    return {
        task_id: job.task_id,
        state: job.state,
        pid: job.pid,
        command: job.command,
        description: job.description,
        cwd: job.cwd,
        started_at: job.started_at,
        ended_at: job.ended_at,
        exit_code: job.exit_code,
        running_for_ms: Math.max(0, runningForMs),
        output: job.output,
        output_truncated: job.output_truncated,
        log_path: job.log_path
    };
}

/** Schedule the job for removal from the registry after retention elapses. */
export function scheduleJobRetention(taskId: string): void {
    const existing = retentionTimers.get(taskId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
        jobsById.delete(taskId);
        retentionTimers.delete(taskId);
        progressListenersByJob.delete(taskId);
        lifecycleListenersByJob.delete(taskId);
    }, RETAIN_COMPLETED_MS);
    // Don't keep the Node process alive solely for registry GC.
    if (typeof timer === "object" && timer && "unref" in timer) {
        try {
            (timer as { unref?: () => void }).unref?.();
        } catch {
            // ignore
        }
    }
    retentionTimers.set(taskId, timer);
}

// ─── Pub/sub ──────────────────────────────────────────────────────────────────

export function subscribeToShellProgress(
    conversationId: string,
    listener: ProgressListener
): () => void {
    const set = progressListenersByConversation.get(conversationId) ?? new Set();
    set.add(listener);
    progressListenersByConversation.set(conversationId, set);
    return () => {
        const current = progressListenersByConversation.get(conversationId);
        if (!current) return;
        current.delete(listener);
        if (current.size === 0) {
            progressListenersByConversation.delete(conversationId);
        }
    };
}

export function subscribeToShellLifecycle(
    conversationId: string,
    listener: LifecycleListener
): () => void {
    const set = lifecycleListenersByConversation.get(conversationId) ?? new Set();
    set.add(listener);
    lifecycleListenersByConversation.set(conversationId, set);
    return () => {
        const current = lifecycleListenersByConversation.get(conversationId);
        if (!current) return;
        current.delete(listener);
        if (current.size === 0) {
            lifecycleListenersByConversation.delete(conversationId);
        }
    };
}

export function subscribeToJobProgress(
    taskId: string,
    listener: ProgressListener
): () => void {
    const set = progressListenersByJob.get(taskId) ?? new Set();
    set.add(listener);
    progressListenersByJob.set(taskId, set);
    return () => {
        const current = progressListenersByJob.get(taskId);
        if (!current) return;
        current.delete(listener);
        if (current.size === 0) progressListenersByJob.delete(taskId);
    };
}

export function subscribeToJobLifecycle(
    taskId: string,
    listener: LifecycleListener
): () => void {
    const set = lifecycleListenersByJob.get(taskId) ?? new Set();
    set.add(listener);
    lifecycleListenersByJob.set(taskId, set);
    return () => {
        const current = lifecycleListenersByJob.get(taskId);
        if (!current) return;
        current.delete(listener);
        if (current.size === 0) lifecycleListenersByJob.delete(taskId);
    };
}

export function emitShellProgress(event: ShellProgressEvent): void {
    const perConv = progressListenersByConversation.get(event.conversation_id);
    if (perConv) {
        for (const listener of perConv) {
            try {
                listener(event);
            } catch (error) {
                logger.error("[shell] progress listener threw", error);
            }
        }
    }
    const perJob = progressListenersByJob.get(event.task_id);
    if (perJob) {
        for (const listener of perJob) {
            try {
                listener(event);
            } catch (error) {
                logger.error("[shell] per-job progress listener threw", error);
            }
        }
    }
}

export function emitShellLifecycle(event: ShellLifecycleEvent): void {
    const perConv = lifecycleListenersByConversation.get(event.conversation_id);
    if (perConv) {
        for (const listener of perConv) {
            try {
                listener(event);
            } catch (error) {
                logger.error("[shell] lifecycle listener threw", error);
            }
        }
    }
    const perJob = lifecycleListenersByJob.get(event.task_id);
    if (perJob) {
        for (const listener of perJob) {
            try {
                listener(event);
            } catch (error) {
                logger.error("[shell] per-job lifecycle listener threw", error);
            }
        }
    }
}

/**
 * Purge cached listeners and optionally kill running foreground jobs for a
 * conversation (called from stream.ts on abort / error paths).
 */
export function clearConversationListeners(conversationId: string): void {
    progressListenersByConversation.delete(conversationId);
    lifecycleListenersByConversation.delete(conversationId);
}
