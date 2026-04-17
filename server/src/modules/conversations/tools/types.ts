import type { z } from "zod";

export interface ToolDefinition<TInput extends object = object, TOutput = unknown> {
    name: string;
    description: string;
    inputSchema: z.ZodType<TInput>;
    execute: (input: TInput) => Promise<TOutput>;
}
