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
 * Prompt body for `/init`. The literal `/init` token the user types is
 * replaced with this text in `ChatInput.handleSend` before the message
 * is sent to the model. Kept inline here (rather than fetched) so the
 * popover renders instantly and `/init` works offline.
 */
const INIT_PROMPT = `Generate (or refresh, if one already exists) an \`AGENTS.md\` file at the repository root that documents this codebase as the operational contract for both human and AI agents working in it.

Investigate the project before writing — read the package manifests, build/run scripts, configuration files, source layout, and any existing docs (README, AGENTS.md, CLAUDE.md, etc.) so the result reflects the actual current state of the repo.

The file should cover, at minimum:

- **Project shape** — what this codebase is, the high-level architecture, and how the major pieces fit together (a small mermaid diagram is welcome when it clarifies the data flow).
- **Tech stack** — runtimes, frameworks, and key libraries per package/folder.
- **Folder map** — top-level directories and what lives in each.
- **Run, build, test, lint** — exact commands to run from each package, plus the package manager policy (e.g. \`bun\` vs \`npm\`).
- **Environment** — required env vars, default ports, auth, and external services.
- **Runtime behavior** — anything an agent needs to know to safely make changes (storage locations, IPC, sidecar processes, background workers, etc.).
- **Coding conventions** — naming, formatting, import rules, and anything project-specific.
- **Operational contract** — the rule that every architectural / scripts / env / port / folder-structure / workflow change must update \`AGENTS.md\` in the same change.

Use clear section headings, fenced code blocks for commands, and concise prose — favor density over filler. When the file already exists, refresh it in place rather than starting from scratch, preserving any conventions that still hold and only rewriting sections that have drifted.

Once the content is ready, write it to \`AGENTS.md\` at the repository root.`;

/**
 * Hard-coded built-in mode + prompt commands. These are NOT fetched from
 * the server — they're always available so the popover renders instantly,
 * even before the skill list resolves. Kept in sync with the values
 * accepted by `useAgenticMode` / `usePermissionMode`.
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
    },
    {
        name: "init",
        label: "/init",
        description: "Generate or refresh AGENTS.md for this repo",
        kind: "prompt",
        prompt: INIT_PROMPT
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
