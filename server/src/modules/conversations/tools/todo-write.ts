import { z } from "zod";
import { logger } from "../../../lib/logger";
import {
    replaceTodos,
    type Todo,
    type TodoStatus
} from "../todos";
import type { ToolDefinition } from "./types";

const todoStatusSchema = z.enum([
    "pending",
    "in_progress",
    "completed",
    "cancelled"
]);

const todoItemSchema = z.object({
    id: z
        .string()
        .optional()
        .describe(
            "Stable id for this todo. Reuse the id returned from a previous `todo_write` call to update an existing item; omit it to create a new one."
        ),
    content: z
        .string()
        .min(1)
        .describe(
            "Imperative description of the step (e.g. 'Add db migration for todos table'). Keep it short and actionable."
        ),
    status: todoStatusSchema.describe(
        "Current status. Exactly one item should be `in_progress` while you are actively working."
    )
});

export const todoWriteInputSchema = z.object({
    todos: z
        .array(todoItemSchema)
        .describe(
            "The complete, ordered todo list for this conversation. This call REPLACES the existing list — include every item you still want tracked, in the order you want them shown. Items omitted from this array are deleted."
        )
});

export type TodoWriteInput = z.infer<typeof todoWriteInputSchema>;

export interface TodoWriteOutput {
    ok: true;
    todos: Todo[];
    counts: Record<TodoStatus, number>;
}

interface TodoWriteContext {
    workspaceId: string;
    conversationId: string;
}

function makeExecuteTodoWrite(ctx: TodoWriteContext) {
    return async function executeTodoWrite(
        input: TodoWriteInput
    ): Promise<TodoWriteOutput> {
        const inProgressCount = input.todos.filter(
            (t) => t.status === "in_progress"
        ).length;
        if (inProgressCount > 1) {
            throw new Error(
                `Only one todo can be in_progress at a time (got ${inProgressCount}). Mark the others as pending or completed.`
            );
        }

        const todos = replaceTodos(
            ctx.workspaceId,
            ctx.conversationId,
            input.todos
        );

        const counts: Record<TodoStatus, number> = {
            pending: 0,
            in_progress: 0,
            completed: 0,
            cancelled: 0
        };
        for (const t of todos) {
            counts[t.status] += 1;
        }

        logger.log("[tool:todo_write]", {
            conversationId: ctx.conversationId,
            total: todos.length,
            counts
        });

        return { ok: true, todos, counts };
    };
}

const TOOL_DESCRIPTION =
    "Maintain the conversation's todo list. Use this whenever the user asks for non-trivial multi-step work (≥3 steps), gives a list of things to do, or you start/finish a step in an ongoing plan. " +
    "This call REPLACES the entire list — pass every item you want tracked, in order. To update an item, reuse its `id` from a previous call; omit `id` for new items; omit a previous item entirely to delete it. " +
    "Exactly one todo should be `in_progress` at any moment. Statuses: `pending` (not started), `in_progress` (actively working), `completed` (done), `cancelled` (no longer needed). " +
    "Do NOT use for trivial single-step tasks or pure conversation. The current list is always re-injected into your system prompt, so you do not need a separate read tool.";

export function createTodoWriteToolDef(
    ctx: TodoWriteContext
): ToolDefinition<TodoWriteInput, TodoWriteOutput> {
    return {
        name: "todo_write",
        description: TOOL_DESCRIPTION,
        inputSchema: todoWriteInputSchema,
        execute: makeExecuteTodoWrite(ctx)
    };
}

export const todoWriteToolDef: ToolDefinition<
    TodoWriteInput,
    TodoWriteOutput
> = createTodoWriteToolDef({ workspaceId: "", conversationId: "" });
