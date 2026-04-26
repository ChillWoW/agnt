import { api } from "@/lib/api";
import type { SlashCommand, SlashSkillSource } from "./slash-types";

interface SkillsResponse {
    workspaceId: string;
    workspacePath: string;
    skills: Array<{
        name: string;
        description: string;
        directory: string;
        source: SlashSkillSource;
    }>;
}

/**
 * Hard-coded built-in mode commands. These are NOT fetched from the server —
 * they're always available so the popover renders instantly, even before the
 * skill list resolves. Kept in sync with the values accepted by
 * `useAgenticMode` / `usePermissionMode`.
 */
export const BUILT_IN_SLASH_COMMANDS: SlashCommand[] = [
    {
        name: "agent",
        label: "/agent",
        description: "Switch to Agent mode (full editing tools)",
        kind: "mode",
        mode: { kind: "agentic", value: "agent" }
    },
    {
        name: "plan",
        label: "/plan",
        description: "Switch to Plan mode (read-only + plan creation)",
        kind: "mode",
        mode: { kind: "agentic", value: "plan" }
    },
    {
        name: "ask",
        label: "/ask",
        description: "Ask before running tools that need permission",
        kind: "mode",
        mode: { kind: "permission", value: "ask" }
    },
    {
        name: "bypass",
        label: "/bypass",
        description: "Bypass tool permission prompts in this conversation",
        kind: "mode",
        mode: { kind: "permission", value: "bypass" }
    }
];

export async function fetchWorkspaceSkillCommands(
    workspaceId: string,
    signal?: AbortSignal
): Promise<SlashCommand[]> {
    const data = await api.get<SkillsResponse>(
        `/workspaces/${workspaceId}/skills`,
        { signal }
    );
    return data.skills.map<SlashCommand>((skill) => ({
        name: skill.name,
        label: `/${skill.name}`,
        description: skill.description || "Reusable skill playbook",
        kind: "skill",
        source: skill.source
    }));
}
