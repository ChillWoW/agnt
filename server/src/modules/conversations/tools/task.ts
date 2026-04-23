import { z } from "zod";
import { logger } from "../../../lib/logger";
import { getModelById } from "../../models/models.service";
import { runSubagent, SUBAGENT_TYPE_CONFIGS } from "../subagents";
import type { SubagentType } from "../conversations.types";
import type { ToolDefinition, ToolModelOutput } from "./types";

const subagentTypeEnum = z.enum([
    "generalPurpose",
    "explore",
    "shell",
    "docs",
    "best-of-n-runner"
]);

export const taskInputSchema = z.object({
    subagent_type: subagentTypeEnum.describe(
        "Which subagent_type to spawn. generalPurpose = full tools. explore = read-only codebase exploration. shell = command execution specialist. docs = documentation/how-to answers from AGENTS.md / CLAUDE.md / skills. best-of-n-runner = isolated best-of-N / experimental attempts."
    ),
    description: z
        .string()
        .min(1)
        .max(80)
        .describe(
            "A short, 3-5 word title for the subagent (displayed in the parent's task card and in the subagent's breadcrumb)."
        ),
    prompt: z
        .string()
        .min(1)
        .describe(
            "The full task instructions to send to the subagent as its initial user message. Include ALL context the subagent needs since it does NOT inherit the parent's conversation history."
        ),
    model: z
        .string()
        .optional()
        .describe(
            "Optional model catalog slug to force the subagent onto a specific model (e.g. 'gpt-5.4'). When omitted, the subagent uses the conversation's configured subagent model (default gpt-5.4-mini + high reasoning)."
        )
});

export type TaskInput = z.infer<typeof taskInputSchema>;

export interface TaskOutput {
    ok: true;
    subagentId: string;
    subagentName: string;
    subagentType: SubagentType;
    finalText: string;
    aborted: boolean;
}

export interface TaskToolContext {
    workspaceId: string;
    parentConversationId: string;
    getParentAbortSignal: () => AbortSignal | undefined;
}

const TOOL_DESCRIPTION =
    "Launch a new subagent to handle a complex, multi-step task autonomously. " +
    "Each subagent streams into its own conversation and receives only the `prompt` you pass it (no parent chat history). When the subagent finishes, you get its final text back as the tool result. " +
    "\n\nAvailable subagent_types:\n" +
    "- generalPurpose: full-tool agent for researching, searching, and executing multi-step tasks.\n" +
    "- explore: fast, READONLY agent specialized for exploring codebases (cannot modify files). Good for 'where is X?' / 'how does Y work?' questions.\n" +
    "- shell: command execution specialist. Has shell + await_shell + read tools.\n" +
    "- docs: documentation specialist — reads AGENTS.md / CLAUDE.md / SKILL.md / web docs.\n" +
    "- best-of-n-runner: isolated experimental runner for best-of-N attempts (git-worktree isolation is planned but not yet implemented — for now it behaves like generalPurpose; be careful with destructive writes).\n" +
    "\nSubagents cannot themselves spawn more subagents (no nested `task` calls).\n" +
    "Prefer subagents for: exploring unfamiliar code, running broad searches, verifying hypotheses in parallel, or isolating multi-file changes. Do NOT spawn a subagent for a trivial 1-step task you could do inline.";

function makeExecute(ctx: TaskToolContext) {
    return async function executeTask(input: TaskInput): Promise<TaskOutput> {
        if (input.model) {
            const modelRow = getModelById(input.model);
            if (!modelRow) {
                throw new Error(
                    `Unknown model slug: "${input.model}". Omit the 'model' field to use the conversation's configured subagent model.`
                );
            }
        }

        logger.log("[tool:task] spawning subagent", {
            parent: ctx.parentConversationId,
            subagentType: input.subagent_type,
            description: input.description,
            hasModelOverride: Boolean(input.model)
        });

        const result = await runSubagent({
            workspaceId: ctx.workspaceId,
            parentConversationId: ctx.parentConversationId,
            subagentType: input.subagent_type,
            description: input.description,
            prompt: input.prompt,
            modelOverride: input.model,
            parentAbortSignal: ctx.getParentAbortSignal()
        });

        logger.log("[tool:task] subagent finished", {
            id: result.subagentId,
            aborted: result.aborted,
            finalTextLength: result.finalText.length
        });

        return {
            ok: true,
            subagentId: result.subagentId,
            subagentName: result.subagentName,
            subagentType: result.subagentType,
            finalText: result.finalText,
            aborted: result.aborted
        };
    };
}

function toModelOutput({ output }: { input: TaskInput; output: TaskOutput }): ToolModelOutput {
    // Narrow the model-visible output to the final text. The subagentId /
    // name / type round-trip through the saved tool invocation so the UI
    // can still render the TaskBlock with full metadata, but the model
    // only needs the final text for context.
    const header = output.aborted
        ? `[Subagent ${output.subagentName} (${output.subagentType}) was aborted before completion]`
        : `[Subagent ${output.subagentName} (${output.subagentType}) final result]`;
    const body = output.finalText.trim().length > 0
        ? output.finalText
        : "(subagent returned no final text)";
    return {
        type: "text",
        value: `${header}\n\n${body}`
    };
}

export function createTaskToolDef(
    ctx: TaskToolContext
): ToolDefinition<TaskInput, TaskOutput> {
    return {
        name: "task",
        description: TOOL_DESCRIPTION,
        inputSchema: taskInputSchema,
        execute: makeExecute(ctx),
        toModelOutput
    };
}

export const taskToolDef: ToolDefinition<TaskInput, TaskOutput> =
    createTaskToolDef({
        workspaceId: "",
        parentConversationId: "",
        getParentAbortSignal: () => undefined
    });

export { SUBAGENT_TYPE_CONFIGS };
