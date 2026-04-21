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

export const BASE_SYSTEM_INSTRUCTIONS =
    "You are Agnt, a helpful AI assistant. Help the user with their questions and tasks. Be concise and clear.\n\n" +
    "When the user references paths with an `@` prefix (e.g. `@src/foo.ts` for a file or `@src/bar/` for a folder), treat those as explicit pointers the user wants you to inspect. Use your `read_file`, `glob`, and `grep` tools to examine them before answering. Never fabricate their contents.";

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
    conversationId?: string
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
    // `prompt` is what goes into the Responses API `instructions` field. It
    // is intentionally stable across turns so the OpenAI prompt cache (keyed
    // on conversationId via `prompt_cache_key`) keeps hitting. The volatile
    // todos block is exposed on the returned object so callers can inject
    // it elsewhere (currently as a trailing system input item in
    // conversation.stream.ts) without perturbing the cached prefix.
    const prompt =
        BASE_SYSTEM_INSTRUCTIONS +
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
        prompt
    };
}
