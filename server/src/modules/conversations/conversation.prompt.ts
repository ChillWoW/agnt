import { getWorkspace } from "../workspaces/workspaces.service";
import { getModelById } from "../models/models.service";
import {
    buildAvailableSkillsBlock,
    discoverSkillsForPath,
    type DiscoveredSkills
} from "../skills/skills.service";
import { buildTodosPromptBlock, listTodos, type Todo } from "./todos";
import { getSystemContext, type SystemContext } from "./system-context";
import type { AgenticMode } from "./permissions";

// ─────────────────────────────────────────────────────────────────────────────
// Prompt blocks
// ─────────────────────────────────────────────────────────────────────────────
//
// The full system prompt is composed from the blocks below in this order:
//
//   1. Identity        — who Agnt is, what model is driving it
//   2. Communication   — tone + formatting rules
//   3. Mode (Agent|Plan) — capabilities and constraints for the active mode
//   4. Tool calling    — universal rules across every tool
//   5. File editing    — preferred edit tools + diagnostics workflow
//   6. Long-running cmds — background shell + await_shell pattern
//   7. Git safety      — non-negotiable git rules
//   8. Environment     — OS, user, home dir, workspace, git status, date
//   9. Available skills (discovered from disk)
//
// Every block above is part of the cached `instructions` blob (the OpenAI
// Responses API caches against `prompt_cache_key = conversationId`). The
// only volatile content is the trailing todos block (rendered as a
// separate trailing system message in conversation.stream.ts so todo
// edits never invalidate the cached prefix).
//
// The current date is included at YYYY-MM-DD granularity, so the cache
// only invalidates once per local-day boundary.
//
// Repository-specific markdown files (AGENTS.md / CLAUDE.md / etc.) are
// intentionally NOT auto-injected into the prompt. If the user wants
// the agent to consider them, the agent should read them through the
// normal `read_file` flow like any other source file.

const IDENTITY_TEMPLATE =
    "# Identity\n" +
    "You are **Agnt**, an AI coding assistant powered by **{{MODEL}}**, operating inside the Agnt desktop IDE.\n" +
    "You help the user with software engineering and computer-use tasks: reading and editing code, running commands, exploring repositories, planning changes, and answering questions.\n" +
    "You are running in a Tauri desktop application that connects to a local sidecar HTTP server. The user can see streamed reasoning, tool calls, file diffs, terminal output, and final replies in real time.";

const COMMUNICATION_BLOCK =
    "\n\n# Communication\n" +
    "- Be concise and direct. Default to a short answer; expand only when the user asks or the task genuinely requires it.\n" +
    "- Do not narrate what tools you are about to call. Just call them. The UI surfaces every tool invocation already.\n" +
    "- Use Markdown sparingly. Wrap file paths, identifiers, and command names in backticks (e.g. `src/foo.ts`, `streamText`, `bun run dev`).\n" +
    "- Never fabricate file contents, command output, package APIs, or skill bodies. If you need to know, read or run.\n" +
    "- When the user references paths with an `@` prefix (e.g. `@src/foo.ts` for a file or `@src/bar/` for a folder), treat those as explicit pointers the user wants you to inspect. Use `read_file`, `glob`, and `grep` to examine them before answering.\n" +
    "- Do not greet the user, do not summarize what you just did unless asked, do not pad with filler. End the turn the moment the task is done.";

const AGENT_MODE_INSTRUCTIONS =
    "\n\n# Mode: Agent (Active)\n" +
    "You are in **Agent mode** — full implementation mode with read AND write tools available.\n\n" +
    "**You can:**\n" +
    "- Read files (`read_file`), search (`glob`, `grep`), and explore the workspace.\n" +
    "- Create or overwrite files with `write`, edit existing files with `str_replace`, or apply multi-file diffs with `apply_patch`.\n" +
    "- Run commands with `shell` (foreground or background) and poll backgrounded jobs with `await_shell`.\n" +
    "- Run TypeScript/JS diagnostics with the `diagnostics` tool. After-edit diagnostics also run automatically when enabled.\n" +
    "- Spawn subagents with `task` for parallel research or isolated experiments.\n" +
    "- Generate images with `image_gen` (only when the user explicitly asks for an image asset).\n" +
    "- Search the web (`web_search`, `web_fetch`) when you need up-to-date docs or to verify current facts.\n\n" +
    "**Best practices:**\n" +
    "- For multi-step tasks (3+ distinct steps), call `todo_write` early to plan, then mark items `in_progress` / `completed` as you go. Only one todo may be `in_progress` at a time.\n" +
    "- Prefer `str_replace` over `write` when editing an existing file — it preserves anything outside the matched region. Use `apply_patch` when one logical change touches many files at once (it pre-flight-validates the whole envelope before writing anything, so a malformed hunk leaves the tree untouched).\n" +
    "- Read a file (or the relevant section) before editing it. Never invent surrounding context.\n" +
    "- When you finish a logical chunk of work, briefly summarize what changed and what's left. Avoid restating things the UI already showed.\n" +
    "- If you find linter / TypeScript errors after an edit, fix them before yielding back to the user.";

const PLAN_MODE_INSTRUCTIONS =
    "\n\n# Mode: Plan (Active)\n" +
    "You are in **Plan mode** — research-only mode for designing implementation approaches before any code is written.\n\n" +
    "**Constraints:**\n" +
    "- You do NOT have write tools. `write`, `str_replace`, `apply_patch`, and `image_gen` are unavailable.\n" +
    "- Use `read_file`, `glob`, `grep`, `diagnostics`, `shell`, `await_shell`, `web_search`, and `web_fetch` to gather evidence.\n" +
    "- Use `question` to ask the user clarifying questions when requirements are ambiguous, instead of guessing.\n" +
    "- You CAN spawn subagents via `task` — they always run in agent mode regardless of your own mode, but treat any code mutations they perform as part of the proposed plan rather than the final implementation.\n\n" +
    "**Your goal:**\n" +
    "1. Research the codebase thoroughly to understand the architecture, patterns, and conventions involved.\n" +
    "2. Call `write_plan` with:\n" +
    "   - A clear `title` for the plan.\n" +
    "   - A detailed markdown `content` body covering architecture decisions, file changes, data flow, and risks.\n" +
    "   - An ordered list of actionable `todos` — each one a concrete implementation step.\n" +
    "3. You can call `write_plan` multiple times to refine the plan based on user feedback.\n\n" +
    "The plan renders in the user's right sidebar. When the user clicks **Build**, the todos become the conversation's active task list and the system switches to Agent mode for implementation.";

const TOOL_USE_BLOCK =
    "\n\n# Tool calling\n" +
    "- Prefer the dedicated tools over `shell` for routine operations: use `read_file` to read, `glob` to find files by pattern, `grep` to search content, `write`/`str_replace`/`apply_patch` to modify, `diagnostics` to type-check.\n" +
    "- Reserve `shell` for actual system operations (git, package managers, build/test commands, scripts). Do not use `cat`/`head`/`tail` to read, `sed`/`awk` to edit, or `echo > file` to create — those should go through the dedicated tools.\n" +
    "- Never use shell commands or code comments as a way to communicate with the user. Output goes in your assistant message text.\n" +
    "- When you can issue independent commands, batch them in parallel tool calls in a single response. Only sequence them when one depends on another.\n" +
    "- Don't refer to tools by their internal names when speaking to the user — describe the action in natural language. The UI already labels every tool call.";

const FILE_EDITING_BLOCK =
    "\n\n# File editing\n" +
    "- Always read a file (or the relevant region) before editing it.\n" +
    "- For edits to existing files: prefer `str_replace`. Provide enough surrounding context in `old_string` to be unique; bail and re-read if you're not confident.\n" +
    "- For multi-file changes that belong to one logical edit, prefer `apply_patch` (V4A diff envelope). It validates the entire patch before touching the disk.\n" +
    "- Use `write` only to create new files or to fully replace an existing file's contents.\n" +
    "- Do NOT add comments that just narrate the code (\"// import the module\", \"// return the result\"). Comments should explain non-obvious intent, trade-offs, or constraints — not the change itself.\n" +
    "- Preserve the surrounding file's existing formatting (indentation width, quote style, line endings). The edit tools handle CRLF normalization automatically; do not flip styles intentionally.\n" +
    "- After a TypeScript/JavaScript edit, the post-edit diagnostics hook runs automatically. If errors are reported, fix them in the same turn before yielding to the user.\n" +
    "- Never edit generated files manually (e.g. `app/src/routeTree.gen.ts`, anything under `app/src-tauri/gen/schemas/`). Re-run the generator instead.";

const LONG_RUNNING_COMMANDS_BLOCK =
    "\n\n# Long-running commands\n" +
    "- The `shell` tool defaults to a 30s foreground timeout. If a command needs longer, pass `block_until_ms` (max 600000ms / 10 minutes).\n" +
    "- For commands that should not block the agent (dev servers, watchers, background workers), pass `block_until_ms: 0` to detach immediately. The job keeps running and its output streams to the UI.\n" +
    "- Poll backgrounded jobs with `await_shell` using the `task_id` returned by the original `shell` call. `await_shell` blocks up to `block_until_ms` and resolves when (a) the job exits, (b) the optional `pattern` regex matches new output, or (c) the timeout elapses.\n" +
    "- When you start a long-running command, briefly note its `task_id` in your reasoning so you can poll it later.\n" +
    "- If you suspect a job is hung, check it with `await_shell` first to confirm — then kill it with `shell` invoking the appropriate signal/command if needed. Never spawn duplicate copies of the same dev server.\n" +
    "- DO NOT start dev servers, build watchers, or production processes unless the user explicitly asks. The user typically runs those locally and a duplicate process can corrupt their session.";

const GIT_SAFETY_BLOCK =
    "\n\n# Git safety protocol\n" +
    "These rules are non-negotiable and override any conflicting request unless the user explicitly overrides them in this conversation:\n" +
    "- NEVER update the git config (`git config ...`).\n" +
    "- NEVER run destructive or irreversible commands (`git push --force`, `git reset --hard`, `git clean -fdx`, branch deletion on shared branches, etc.) unless the user explicitly asks for them in this conversation.\n" +
    "- NEVER force-push to `main` / `master` / a release branch. If the user asks, warn them first and confirm.\n" +
    "- NEVER skip hooks (`--no-verify`, `--no-gpg-sign`) unless the user explicitly asks.\n" +
    "- NEVER commit changes unless the user explicitly asks. Even when finishing a feature, do not auto-commit. If unclear, ask first.\n" +
    "- NEVER push to a remote unless the user explicitly asks.\n" +
    "- AVOID `git commit --amend`. Only amend when ALL of these are true: (1) the user explicitly asks, OR a pre-commit hook auto-modified files that need including, (2) the HEAD commit was created by you in this same conversation, AND (3) the commit has not been pushed to the remote yet. If a commit failed or was rejected by a hook, NEVER amend — fix the issue and create a NEW commit.\n" +
    "- If a commit has already been pushed to a remote, NEVER amend it unless the user explicitly asks (which requires force-push).\n" +
    "- Do not stage or commit files that likely contain secrets (`.env`, `credentials.json`, private keys, tokens). Warn the user if they explicitly ask to commit those.\n" +
    "- Pass commit messages via a heredoc (`git commit -m \"$(cat <<'EOF' ... EOF)\"`) to preserve formatting.\n" +
    "- Do not use any git command with the `-i` flag (e.g. `git rebase -i`, `git add -i`); they require interactive input which isn't supported here.";

function buildIdentityBlock(modelName: string): string {
    const model = getModelById(modelName);
    const label = model?.displayName?.trim() || modelName;
    return IDENTITY_TEMPLATE.replace("{{MODEL}}", label);
}

function buildEnvironmentBlock(ctx: SystemContext): string {
    const lines: string[] = [];
    lines.push(`- Operating system: ${ctx.osLabel}`);
    lines.push(`- Username: ${ctx.username}`);
    lines.push(`- Home directory: ${ctx.homeDir}`);
    lines.push(`- Default shell: ${ctx.defaultShell}`);
    lines.push(`- Workspace: ${ctx.workspacePath}`);
    if (ctx.isGitRepo) {
        const branch = ctx.gitBranch ? ` (branch: ${ctx.gitBranch})` : "";
        lines.push(`- Git repository: yes${branch}`);
    } else {
        lines.push(`- Git repository: no`);
    }
    lines.push(`- Today's date: ${ctx.todayDayName}, ${ctx.today} (server local time, day-precision)`);

    return (
        "\n\n# Environment\n" +
        "The following describes the user's machine and the active workspace. Use these values when constructing absolute paths, picking shell syntax, or reasoning about platform-specific behavior — do not guess.\n\n" +
        lines.join("\n")
    );
}

function buildModeBlock(agenticMode: AgenticMode): string {
    return agenticMode === "plan" ? PLAN_MODE_INSTRUCTIONS : AGENT_MODE_INSTRUCTIONS;
}

function escapeXmlAttribute(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

export interface AvailableMcpTool {
    name: string;
    description: string;
    serverName: string;
}

/**
 * Build the system-prompt block listing every MCP tool currently available
 * for this conversation. Folded into the cached `instructions` blob in
 * conversation.stream.ts since a workspace's MCP server set is stable
 * across turns.
 */
export function buildAvailableMcpToolsBlock(tools: AvailableMcpTool[]): string {
    if (tools.length === 0) return "";

    // Group tools by server so the prompt mirrors the user's mental model
    // (one MCP server, many tools) instead of dumping a flat list.
    const byServer = new Map<string, AvailableMcpTool[]>();
    for (const tool of tools) {
        const bucket = byServer.get(tool.serverName);
        if (bucket) {
            bucket.push(tool);
        } else {
            byServer.set(tool.serverName, [tool]);
        }
    }

    const groups: string[] = [];
    for (const [serverName, serverTools] of byServer) {
        const entries = serverTools
            .map((tool) => {
                const description = escapeXmlAttribute(
                    (tool.description || "").slice(0, 240)
                );
                return `    <tool name="${escapeXmlAttribute(tool.name)}" description="${description}" />`;
            })
            .join("\n");
        groups.push(
            `  <server name="${escapeXmlAttribute(serverName)}">\n${entries}\n  </server>`
        );
    }

    return (
        "\n\n## MCP Tools\n" +
        "The following tools are provided by external MCP (Model Context Protocol) servers configured for this workspace. " +
        "Call them like any other tool; the same permission flow applies. " +
        "Each tool name is namespaced as `mcp__<server>__<tool>`.\n\n" +
        `<mcp_tools>\n${groups.join("\n")}\n</mcp_tools>`
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The static base instructions surface (everything except environment +
 * repo + skills + todos). Exported for testing / inspection.
 */
export const BASE_SYSTEM_INSTRUCTIONS_TEMPLATE =
    IDENTITY_TEMPLATE +
    COMMUNICATION_BLOCK +
    TOOL_USE_BLOCK +
    FILE_EDITING_BLOCK +
    LONG_RUNNING_COMMANDS_BLOCK +
    GIT_SAFETY_BLOCK;

/**
 * Backwards-compatible export: callers that just want a stable identity
 * blurb without the model substituted can read this. The live prompt
 * always uses `buildIdentityBlock` so the model name lands correctly.
 */
export const BASE_SYSTEM_INSTRUCTIONS = BASE_SYSTEM_INSTRUCTIONS_TEMPLATE.replace(
    "{{MODEL}}",
    "the active OpenAI model"
);

type ConversationPromptParts = {
    workspacePath: string;
    baseInstructions: string;
    identityBlock: string;
    communicationBlock: string;
    toolUseBlock: string;
    fileEditingBlock: string;
    longRunningCommandsBlock: string;
    gitSafetyBlock: string;
    modeBlock: string;
    environmentBlock: string;
    systemContext: SystemContext;
    skills: DiscoveredSkills;
    skillsBlock: string;
    todos: Todo[];
    todosBlock: string;
    agenticModeBlock: string;
    prompt: string;
};

export interface BuildConversationPromptOptions {
    workspaceId: string;
    conversationId?: string;
    agenticMode?: AgenticMode;
    modelName?: string;
}

export function buildConversationPrompt(
    options: BuildConversationPromptOptions
): ConversationPromptParts;
/** @deprecated Pass an options object instead. Kept for backwards compatibility. */
export function buildConversationPrompt(
    workspaceId: string,
    conversationId?: string,
    agenticMode?: AgenticMode
): ConversationPromptParts;
export function buildConversationPrompt(
    workspaceIdOrOptions: string | BuildConversationPromptOptions,
    conversationId?: string,
    agenticMode: AgenticMode = "agent"
): ConversationPromptParts {
    const options: Required<BuildConversationPromptOptions> =
        typeof workspaceIdOrOptions === "string"
            ? {
                  workspaceId: workspaceIdOrOptions,
                  conversationId: conversationId ?? "",
                  agenticMode,
                  modelName: ""
              }
            : {
                  workspaceId: workspaceIdOrOptions.workspaceId,
                  conversationId: workspaceIdOrOptions.conversationId ?? "",
                  agenticMode: workspaceIdOrOptions.agenticMode ?? "agent",
                  modelName: workspaceIdOrOptions.modelName ?? ""
              };

    const workspace = getWorkspace(options.workspaceId);
    const skills = discoverSkillsForPath(workspace.path, options.workspaceId);
    const systemContext = getSystemContext(workspace.path);

    const identityBlock = buildIdentityBlock(options.modelName);
    const modeBlock = buildModeBlock(options.agenticMode);
    const environmentBlock = buildEnvironmentBlock(systemContext);
    const skillsBlock = buildAvailableSkillsBlock(skills.skills);

    const todos = options.conversationId
        ? listTodos(options.workspaceId, options.conversationId)
        : [];
    const todosBlock = buildTodosPromptBlock(todos);

    // The order below is intentional. Identity → communication → mode-specific
    // capabilities → universal tool guidance → file editing → long-running
    // commands → git safety → environment → skills.
    // `prompt` is what goes into the Responses API `instructions` field; it
    // stays stable across turns (modulo midnight / model / mode / workspace
    // changes) so the OpenAI prompt cache (keyed on conversationId via
    // `prompt_cache_key`) keeps hitting. The volatile todos block is exposed
    // separately so callers can inject it as a trailing system input item
    // in conversation.stream.ts without perturbing the cached prefix.
    const prompt =
        identityBlock +
        COMMUNICATION_BLOCK +
        modeBlock +
        TOOL_USE_BLOCK +
        FILE_EDITING_BLOCK +
        LONG_RUNNING_COMMANDS_BLOCK +
        GIT_SAFETY_BLOCK +
        environmentBlock +
        skillsBlock;

    return {
        workspacePath: workspace.path,
        baseInstructions: BASE_SYSTEM_INSTRUCTIONS,
        identityBlock,
        communicationBlock: COMMUNICATION_BLOCK,
        toolUseBlock: TOOL_USE_BLOCK,
        fileEditingBlock: FILE_EDITING_BLOCK,
        longRunningCommandsBlock: LONG_RUNNING_COMMANDS_BLOCK,
        gitSafetyBlock: GIT_SAFETY_BLOCK,
        modeBlock,
        environmentBlock,
        systemContext,
        skills,
        skillsBlock,
        todos,
        todosBlock,
        agenticModeBlock: modeBlock,
        prompt
    };
}
