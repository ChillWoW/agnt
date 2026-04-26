import { BUILT_IN_SLASH_COMMANDS, fetchWorkspaceSkillCommands } from "./slash-api";
import type { SlashCommand } from "./slash-types";

// Per-workspace caches so the popup can render instantly even before the
// fresh skill listing resolves. Mirrors the pattern in
// `app/src/features/workspaces/mention-search.ts`.
const skillCache = new Map<string, SlashCommand[]>();
const inflight = new Map<string, Promise<SlashCommand[]>>();

function dedupByName(commands: SlashCommand[]): SlashCommand[] {
    const seen = new Set<string>();
    const result: SlashCommand[] = [];
    for (const cmd of commands) {
        const key = cmd.name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(cmd);
    }
    return result;
}

/**
 * Synchronous cache read. Always returns the built-ins concatenated with
 * whatever skills were last fetched for this workspace (or just the
 * built-ins if no fetch has succeeded yet). Built-ins win on name
 * collision so a user-defined skill named `plan` cannot shadow `/plan`.
 */
export function readCachedSlashCommands(
    workspaceId: string | null | undefined
): SlashCommand[] {
    if (!workspaceId) return BUILT_IN_SLASH_COMMANDS;
    const skills = skillCache.get(workspaceId) ?? [];
    return dedupByName([...BUILT_IN_SLASH_COMMANDS, ...skills]);
}

/**
 * Background fetch + cache. Built-ins are always present; skills are
 * appended once the workspace's `/skills` response resolves.
 */
export async function loadSlashCommands(
    workspaceId: string,
    signal?: AbortSignal
): Promise<SlashCommand[]> {
    const existing = inflight.get(workspaceId);
    if (existing) return existing;

    const promise = (async () => {
        const skills = await fetchWorkspaceSkillCommands(workspaceId, signal);
        skillCache.set(workspaceId, skills);
        return dedupByName([...BUILT_IN_SLASH_COMMANDS, ...skills]);
    })().finally(() => {
        inflight.delete(workspaceId);
    });

    inflight.set(workspaceId, promise);
    return promise;
}

/**
 * Fire-and-forget prefetch so the very first `/` press is instant.
 */
export function prefetchSlashCommands(workspaceId: string): void {
    if (skillCache.has(workspaceId) || inflight.has(workspaceId)) return;
    void loadSlashCommands(workspaceId).catch(() => {
        // swallow — popup will fall back to built-ins
    });
}
