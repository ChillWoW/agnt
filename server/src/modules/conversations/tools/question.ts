import { z } from "zod";
import { logger } from "../../../lib/logger";
import { requestQuestions } from "../questions";
import type { ToolDefinition } from "./types";

const questionOptionSchema = z.object({
    label: z
        .string()
        .min(1)
        .describe(
            "Short display text, around 1-5 words. If this is the recommended option, append ' (Recommended)' to the label and place it first."
        ),
    description: z
        .string()
        .describe("Short explanation of what this option means.")
});

const singleQuestionSchema = z.object({
    question: z.string().min(1).describe("The full text of the question."),
    header: z
        .string()
        .min(1)
        .max(30)
        .describe("A very short label for the question (max 30 chars)."),
    options: z
        .array(questionOptionSchema)
        .min(2)
        .describe(
            "The predefined answer choices. A 'Type your own answer' option is ALWAYS appended to this list on the UI side, so do NOT include catch-all options like 'Other'. If an option is recommended, put it first and append ' (Recommended)' to its label."
        ),
    multiple: z
        .boolean()
        .describe(
            "true = the user can select multiple options; false = single selection only."
        )
});

export const questionInputSchema = z.object({
    questions: z
        .array(singleQuestionSchema)
        .min(1)
        .describe("A list of one or more questions to show the user.")
});

export type QuestionInput = z.infer<typeof questionInputSchema>;

export interface QuestionOutput {
    answers: string[][];
    cancelled: boolean;
}

interface QuestionExecuteContext {
    conversationId: string;
}

function makeExecuteQuestion(ctx: QuestionExecuteContext) {
    return async function executeQuestion(
        input: QuestionInput
    ): Promise<QuestionOutput> {
        logger.log("[tool:question] asking", {
            conversationId: ctx.conversationId,
            count: input.questions.length
        });

        const result = await requestQuestions({
            conversationId: ctx.conversationId,
            questions: input.questions
        });

        logger.log("[tool:question] answered", {
            conversationId: ctx.conversationId,
            cancelled: result.cancelled,
            answers: result.answers
        });

        return { answers: result.answers, cancelled: result.cancelled };
    };
}

const TOOL_DESCRIPTION =
    "Ask the user structured follow-up multiple-choice questions during execution. " +
    "Use for missing product decisions, preference choices, mutually exclusive implementation paths, " +
    "or confirming a direction when multiple valid paths exist. " +
    "Do NOT use when you can reasonably infer the right action, for routine progress updates, " +
    "or when the task can be executed directly without blocking ambiguity. " +
    "A 'Type your own answer' option is automatically added to every question, so do NOT include catch-all options like 'Other'. " +
    "If you want to recommend an option, put it first in the options list and append ' (Recommended)' to its label. " +
    "The tool blocks until the user answers, and returns `{ answers: string[][], cancelled: boolean }`. " +
    "Each inner answers array is the selected option labels for the matching question (even single-select responses come back as a 1-element array). " +
    "Custom typed responses are returned as the raw user-entered string. " +
    "When `cancelled` is true the user dismissed the questions without answering, `answers` will be empty, and you should continue the task on your own using reasonable defaults instead of asking again.";

export function createQuestionToolDef(
    ctx: QuestionExecuteContext
): ToolDefinition<QuestionInput, QuestionOutput> {
    return {
        name: "question",
        description: TOOL_DESCRIPTION,
        inputSchema: questionInputSchema,
        execute: makeExecuteQuestion(ctx)
    };
}

export const questionToolDef: ToolDefinition<QuestionInput, QuestionOutput> =
    createQuestionToolDef({ conversationId: "" });
