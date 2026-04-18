import { getWorkspace } from "../workspaces/workspaces.service";
import {
    resolveRepoInstructions,
    type ResolvedRepoInstructions
} from "./repo-instructions";

export const BASE_SYSTEM_INSTRUCTIONS =
    "You are Agnt, a helpful AI assistant. Help the user with their questions and tasks. Be concise and clear.";

type ConversationPromptParts = {
    workspacePath: string;
    baseInstructions: string;
    workspaceBlock: string;
    repoInstructions: ResolvedRepoInstructions;
    warningBlock: string;
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
    workspaceId: string
): ConversationPromptParts {
    const workspace = getWorkspace(workspaceId);
    const repoInstructions = resolveRepoInstructions(workspaceId);
    const workspaceBlock = buildWorkspaceBlock(workspace.path);
    const warningBlock = buildWarningBlock(repoInstructions);
    const prompt =
        BASE_SYSTEM_INSTRUCTIONS +
        workspaceBlock +
        repoInstructions.promptBlock +
        warningBlock;

    return {
        workspacePath: workspace.path,
        baseInstructions: BASE_SYSTEM_INSTRUCTIONS,
        workspaceBlock,
        repoInstructions,
        warningBlock,
        prompt
    };
}
