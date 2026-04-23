import type { SubagentType } from "../conversations.types";

/**
 * Per-subagent-type configuration: allowed tool set + short system prompt
 * addition.
 *
 * Tool allowlists are strict — the model can only see the tools listed here
 * when it runs as a subagent of the corresponding type. The `task` tool is
 * NEVER included in any subagent's toolset (enforced independently in
 * `buildConversationTools`) so subagents cannot recursively spawn more
 * subagents.
 *
 * `best-of-n-runner` is intentionally a stub today: in a future change it
 * should get proper git-worktree isolation (each best-of-N attempt runs in
 * its own branch + working tree). For now it just shares the same tools as
 * generalPurpose, so the model can already request it by name and the UI
 * renders it as a dedicated type.
 */
export interface SubagentTypeConfig {
    label: string;
    description: string;
    allowedTools: readonly string[];
    systemPromptAddition: string;
}

const GENERAL_PURPOSE_TOOLS: readonly string[] = [
    "read_file",
    "glob",
    "grep",
    "use_skill",
    "question",
    "todo_write",
    "web_search",
    "web_fetch",
    "write",
    "str_replace",
    "apply_patch",
    "shell",
    "await_shell",
    "image_gen"
];

const EXPLORE_TOOLS: readonly string[] = [
    "read_file",
    "glob",
    "grep",
    "use_skill",
    "question",
    "todo_write",
    "web_search",
    "web_fetch"
];

const SHELL_TOOLS: readonly string[] = [
    "shell",
    "await_shell",
    "read_file",
    "glob",
    "grep",
    "use_skill",
    "question",
    "todo_write"
];

const DOCS_TOOLS: readonly string[] = [
    "read_file",
    "glob",
    "grep",
    "use_skill",
    "question",
    "web_fetch"
];

export const SUBAGENT_TYPE_CONFIGS: Record<SubagentType, SubagentTypeConfig> = {
    generalPurpose: {
        label: "General-purpose",
        description:
            "General-purpose agent for researching complex questions, searching for code, and executing multi-step tasks.",
        allowedTools: GENERAL_PURPOSE_TOOLS,
        systemPromptAddition:
            "\n\n## Subagent: generalPurpose\nYou are a general-purpose subagent. Work autonomously to complete the task described in the user message. When done, respond with a concise final summary that the parent agent can use — no need to re-describe the task."
    },
    explore: {
        label: "Explore",
        description:
            "Fast, readonly agent specialized for exploring codebases. Cannot modify files.",
        allowedTools: EXPLORE_TOOLS,
        systemPromptAddition:
            "\n\n## Subagent: explore (read-only)\nYou are a read-only explore subagent. You CANNOT modify files. Use `read_file`, `glob`, `grep`, `web_search`, and `web_fetch` to find files, search code, or answer questions about the codebase. When done, respond with a concise summary of your findings for the parent agent."
    },
    shell: {
        label: "Shell",
        description:
            "Command execution specialist for running bash/powershell commands and other terminal tasks.",
        allowedTools: SHELL_TOOLS,
        systemPromptAddition:
            "\n\n## Subagent: shell\nYou are a shell-focused subagent. Use `shell` and `await_shell` to execute commands. You may read files to inspect output but cannot write/patch them. When done, respond with a concise summary of what was run and the outcome."
    },
    docs: {
        label: "Docs",
        description:
            "Documentation specialist. Reads repo instructions (AGENTS.md, CLAUDE.md), skills, and web docs to answer 'how do I…?' style questions.",
        allowedTools: DOCS_TOOLS,
        systemPromptAddition:
            "\n\n## Subagent: docs\nYou are a documentation subagent. Focus on reading `AGENTS.md`, `CLAUDE.md`, `SKILL.md` files, and web documentation to answer the parent's question. When done, respond with a concise answer citing the source files."
    },
    "best-of-n-runner": {
        label: "Best-of-N runner",
        description:
            "Isolated runner for best-of-N parallel attempts or experiments. (Git-worktree isolation is planned but not yet implemented — for now it behaves like generalPurpose.)",
        allowedTools: GENERAL_PURPOSE_TOOLS,
        systemPromptAddition:
            "\n\n## Subagent: best-of-n-runner\nYou are a best-of-N runner subagent. Treat your working copy as disposable. NOTE: git-worktree isolation is not yet implemented — be careful with destructive operations, and prefer a new branch if you need to modify files. When done, respond with a concise summary of the attempt."
    }
};

export function getSubagentTypeConfig(type: SubagentType): SubagentTypeConfig {
    return SUBAGENT_TYPE_CONFIGS[type];
}

export function isSubagentType(value: unknown): value is SubagentType {
    return (
        value === "generalPurpose" ||
        value === "explore" ||
        value === "shell" ||
        value === "docs" ||
        value === "best-of-n-runner"
    );
}
