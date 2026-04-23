import { z } from "zod";
import { logger } from "../../../lib/logger";
import { createOrUpdatePlan } from "../plans";
import type { ToolDefinition, ToolModelOutput } from "./types";

const planTodoSchema = z.object({
    id: z
        .string()
        .optional()
        .describe(
            "Stable id for this todo. Reuse the id from a previous write_plan call to preserve identity; omit for new items."
        ),
    content: z
        .string()
        .min(1)
        .describe(
            "Short, imperative description of the implementation step (e.g. 'Add plans table migration')."
        )
});

export const writePlanInputSchema = z.object({
    title: z
        .string()
        .min(1)
        .max(120)
        .describe("Short title for the plan (shown in the sidebar header)."),
    content: z
        .string()
        .min(1)
        .describe(
            "Full markdown body of the implementation plan. Include architecture decisions, file changes, data flow, and any important notes."
        ),
    todos: z
        .array(planTodoSchema)
        .min(1)
        .describe(
            "Ordered list of actionable implementation steps. These become the conversation's todo list when the user clicks Build."
        )
});

export type WritePlanInput = z.infer<typeof writePlanInputSchema>;

export interface WritePlanOutput {
    ok: true;
    planId: string;
    title: string;
    filePath: string;
    todoCount: number;
}

interface WritePlanContext {
    workspaceId: string;
    conversationId: string;
}

function makeExecuteWritePlan(ctx: WritePlanContext) {
    return async function executeWritePlan(
        input: WritePlanInput
    ): Promise<WritePlanOutput> {
        const plan = createOrUpdatePlan(
            ctx.workspaceId,
            ctx.conversationId,
            input.content,
            input.title,
            input.todos
        );

        logger.log("[tool:write_plan]", {
            conversationId: ctx.conversationId,
            planId: plan.id,
            todoCount: plan.todos.length
        });

        return {
            ok: true,
            planId: plan.id,
            title: plan.title ?? input.title,
            filePath: plan.file_path,
            todoCount: plan.todos.length
        };
    };
}

function toModelOutput({
    output
}: {
    input: WritePlanInput;
    output: WritePlanOutput;
}): ToolModelOutput {
    return {
        type: "text",
        value: `Plan "${output.title}" saved (${output.todoCount} todos). The plan is now visible in the user's sidebar.`
    };
}

const TOOL_DESCRIPTION =
    "Create or update the implementation plan for this conversation. Use this tool in Plan mode after researching the codebase. " +
    "Provide a comprehensive markdown plan body and an ordered list of actionable implementation todos. " +
    "The plan will be displayed in the user's sidebar. When the user clicks Build, the todos become the conversation's active task list and the agent switches to implementation mode. " +
    "You can call this tool multiple times to refine the plan based on user feedback.";

export function createWritePlanToolDef(
    ctx: WritePlanContext
): ToolDefinition<WritePlanInput, WritePlanOutput> {
    return {
        name: "write_plan",
        description: TOOL_DESCRIPTION,
        inputSchema: writePlanInputSchema,
        execute: makeExecuteWritePlan(ctx),
        toModelOutput
    };
}

export const writePlanToolDef: ToolDefinition<WritePlanInput, WritePlanOutput> =
    createWritePlanToolDef({ workspaceId: "", conversationId: "" });
