import { getWorkspace } from "../workspaces/workspaces.service";
import {
    resolveRepoInstructions,
    type ResolvedRepoInstructions
} from "./repo-instructions";
import {
    buildAvailableSkillsBlock,
    discoverSkillsForPath,
    type DiscoveredSkills
} from "../skills/skills.service";
import { buildTodosPromptBlock, listTodos, type Todo } from "./todos";
import type { AgenticMode } from "./permissions";

export const BASE_SYSTEM_INSTRUCTIONS =
    "You are Agnt, a helpful AI assistant. Help the user with their questions and tasks. Be concise and clear.\n\n" +
    "When the user references paths with an `@` prefix (e.g. `@src/foo.ts` for a file or `@src/bar/` for a folder), treat those as explicit pointers the user wants you to inspect. Use your `read_file`, `glob`, and `grep` tools to examine them before answering. Never fabricate their contents.";

const PLAN_MODE_INSTRUCTIONS =
    "\n\n## Plan Mode (Active)\n" +
    "You are currently in **Plan mode**. Your job is to thoroughly research the codebase and create a detailed implementation plan.\n\n" +
    "**Constraints:**\n" +
    "- You CANNOT create, edit, or delete files. You do NOT have write, str_replace, or apply_patch tools.\n" +
    "- Use `read_file`, `glob`, `grep`, `shell`, and `await_shell` to understand the project structure, existing patterns, and relevant code.\n" +
    "- Use `web_search` and `web_fetch` if you need to research external libraries or APIs.\n" +
    "- Use `question` to ask the user clarifying questions when requirements are ambiguous.\n\n" +
    "**Your goal:**\n" +
    "1. Research the codebase thoroughly to understand the architecture, patterns, and conventions.\n" +
    "2. Create a comprehensive implementation plan by calling `write_plan` with:\n" +
    "   - A clear `title` for the plan.\n" +
    "   - A detailed markdown `content` body covering architecture decisions, file changes needed, data flow, and important notes.\n" +
    "   - An ordered list of actionable `todos` — each one a concrete implementation step.\n" +
    "3. You can call `write_plan` multiple times to refine the plan based on user feedback.\n\n" +
    "The plan will be displayed in the user's sidebar. When the user clicks **Build**, the todos become the active task list and the system switches to Agent mode for implementation.";

type ConversationPromptParts = {
    workspacePath: string;
    baseInstructions: string;
    workspaceBlock: string;
    repoInstructions: ResolvedRepoInstructions;
    warningBlock: string;
    skills: DiscoveredSkills;
    skillsBlock: string;
    todos: Todo[];
    todosBlock: string;
    agenticModeBlock: string;
    prompt: string;
};

function buildWorkspaceBlock(workspacePath: string): string {
    return `\n\n## Workspace\n- Working directory: ${workspacePath}`;
}

function buildWarningBlock(repoInstructions: ResolvedRepoInstructions): string {
    if (repoInstructions.warnings.length === 0) {
        return "";
    }

    return `\n\n## Repository Instruction Loading Notes\n${repoInstructions.warnings
        .map((warning) => `- ${warning}`)
        .join("\n")}`;
}

export function buildConversationPrompt(
    workspaceId: string,
    conversationId?: string,
    agenticMode: AgenticMode = "agent"
): ConversationPromptParts {
    const workspace = getWorkspace(workspaceId);
    const repoInstructions = resolveRepoInstructions(workspaceId);
    const skills = discoverSkillsForPath(workspace.path, workspaceId);
    const workspaceBlock = buildWorkspaceBlock(workspace.path);
    const warningBlock = buildWarningBlock(repoInstructions);
    const skillsBlock = buildAvailableSkillsBlock(skills.skills);
    const todos = conversationId
        ? listTodos(workspaceId, conversationId)
        : [];
    const todosBlock = buildTodosPromptBlock(todos);
    const agenticModeBlock = agenticMode === "plan" ? PLAN_MODE_INSTRUCTIONS : "";
    // `prompt` is what goes into the Responses API `instructions` field. It
    // is intentionally stable across turns so the OpenAI prompt cache (keyed
    // on conversationId via `prompt_cache_key`) keeps hitting. The volatile
    // todos block is exposed on the returned object so callers can inject
    // it elsewhere (currently as a trailing system input item in
    // conversation.stream.ts) without perturbing the cached prefix.
    const prompt =
        BASE_SYSTEM_INSTRUCTIONS +
        agenticModeBlock +
        workspaceBlock +
        repoInstructions.promptBlock +
        warningBlock +
        skillsBlock;

    return {
        workspacePath: workspace.path,
        baseInstructions: BASE_SYSTEM_INSTRUCTIONS,
        workspaceBlock,
        repoInstructions,
        warningBlock,
        skills,
        skillsBlock,
        todos,
        todosBlock,
        agenticModeBlock,
        prompt
    };
}
