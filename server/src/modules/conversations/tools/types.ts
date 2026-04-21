import type { z } from "zod";

/**
 * A ToolResultOutput shape that the AI SDK can forward to the model as a
 * mixed content block (text + image / file). Kept loose here so we don't
 * force a dependency on `@ai-sdk/provider-utils` from every tool module.
 */
export type ToolContentPart =
    | { type: "text"; text: string }
    | { type: "image-data"; data: string; mediaType: string }
    | {
          type: "file-data";
          data: string;
          mediaType: string;
          filename?: string;
      };

export type ToolModelOutput =
    | { type: "text"; value: string }
    | { type: "json"; value: unknown }
    | { type: "content"; value: ToolContentPart[] };

export interface ToolDefinition<TInput extends object = object, TOutput = unknown> {
    name: string;
    description: string;
    inputSchema: z.ZodType<TInput>;
    execute: (input: TInput) => Promise<TOutput>;
    /**
     * Optional transformer that converts the tool's JS return value into the
     * payload sent back to the LLM. Use this when the output should include
     * non-text parts (images, PDFs) in addition to / instead of raw JSON.
     */
    toModelOutput?: (args: {
        input: TInput;
        output: TOutput;
    }) => ToolModelOutput | Promise<ToolModelOutput>;
}
