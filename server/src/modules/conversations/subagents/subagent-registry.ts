import { EventEmitter } from "node:events";
import type { SubagentType } from "../conversations.types";

/**
 * In-memory registry of in-flight subagent runs.
 *
 * A subagent is "in-flight" from the moment `runSubagent(...)` inserts the
 * hidden conversation row until the final assistant turn of that subagent
 * either finishes, aborts, or errors.
 *
 * The registry tracks:
 * - which parent conversation spawned each subagent (for cascade-abort)
 * - each subagent's AbortController (so the parent can stop descendants)
 * - lifecycle event subscribers (so the parent stream can emit
 *   `subagent-started` / `subagent-finished` SSE events and so the frontend
 *   can observe in-flight subagents attached to a parent).
 */

export interface SubagentMeta {
    id: string;
    parentConversationId: string;
    subagentType: SubagentType;
    subagentName: string;
    title: string;
    startedAt: string;
}

interface RegistryEntry {
    meta: SubagentMeta;
    controller: AbortController;
}

interface SubagentStartedEvent {
    type: "started";
    parentConversationId: string;
    subagent: SubagentMeta;
}

interface SubagentFinishedEvent {
    type: "finished";
    parentConversationId: string;
    subagentId: string;
    outcome: "success" | "error" | "aborted";
    finalText: string | null;
    error: string | null;
    endedAt: string;
}

export type SubagentLifecycleEvent =
    | SubagentStartedEvent
    | SubagentFinishedEvent;

const entries = new Map<string, RegistryEntry>();
const byParent = new Map<string, Set<string>>();
const emitter = new EventEmitter();
emitter.setMaxListeners(0);

function keyForParent(parentId: string): Set<string> {
    let set = byParent.get(parentId);
    if (!set) {
        set = new Set();
        byParent.set(parentId, set);
    }
    return set;
}

export function registerSubagent(
    meta: SubagentMeta,
    controller: AbortController
): void {
    entries.set(meta.id, { meta, controller });
    keyForParent(meta.parentConversationId).add(meta.id);
    emitter.emit("lifecycle", {
        type: "started",
        parentConversationId: meta.parentConversationId,
        subagent: meta
    } satisfies SubagentStartedEvent);
}

export function unregisterSubagent(
    subagentId: string,
    outcome: "success" | "error" | "aborted",
    finalText: string | null,
    error: string | null
): void {
    const entry = entries.get(subagentId);
    if (!entry) return;
    entries.delete(subagentId);
    const set = byParent.get(entry.meta.parentConversationId);
    if (set) {
        set.delete(subagentId);
        if (set.size === 0) byParent.delete(entry.meta.parentConversationId);
    }
    emitter.emit("lifecycle", {
        type: "finished",
        parentConversationId: entry.meta.parentConversationId,
        subagentId,
        outcome,
        finalText,
        error,
        endedAt: new Date().toISOString()
    } satisfies SubagentFinishedEvent);
}

export function getSubagent(subagentId: string): SubagentMeta | null {
    return entries.get(subagentId)?.meta ?? null;
}

export function listSubagentsForParent(parentId: string): SubagentMeta[] {
    const set = byParent.get(parentId);
    if (!set) return [];
    const out: SubagentMeta[] = [];
    for (const id of set) {
        const entry = entries.get(id);
        if (entry) out.push(entry.meta);
    }
    return out;
}

/**
 * Abort every in-flight subagent of the given parent conversation. Called
 * from the parent's abort/error path so cascade-stop works.
 */
export function abortSubagentsForParent(
    parentConversationId: string,
    reason = "parent-aborted"
): void {
    const set = byParent.get(parentConversationId);
    if (!set) return;
    for (const id of [...set]) {
        const entry = entries.get(id);
        if (!entry) continue;
        try {
            entry.controller.abort(new Error(reason));
        } catch {
            // ignore — already aborted or finished
        }
    }
}

export function subscribeToSubagentLifecycle(
    listener: (event: SubagentLifecycleEvent) => void
): () => void {
    emitter.on("lifecycle", listener);
    return () => emitter.off("lifecycle", listener);
}
