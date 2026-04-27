import { z } from "zod";
import { logger } from "../../../lib/logger";
import { getMemory, type Memory } from "../../memories";
import type { ToolDefinition } from "./types";

export const memoryReadInputSchema = z.object({
    id: z
        .string()
        .describe(
            "Id of the memory to fetch. Use one of the `id` values from the memory index in the system prompt (or from a previous `memory_write` call)."
        )
});

export type MemoryReadInput = z.infer<typeof memoryReadInputSchema>;

export interface MemoryReadOutput {
    ok: true;
    memory: Memory;
}

async function executeMemoryRead(
    input: MemoryReadInput
): Promise<MemoryReadOutput> {
    const memory = getMemory(input.id);
    if (!memory) {
        throw new Error(
            `Memory not found: ${input.id}. The id may have been deleted or is malformed (expected a UUID).`
        );
    }

    logger.log("[tool:memory_read]", {
        id: memory.id,
        bodyLength: memory.body.length
    });

    return { ok: true, memory };
}

const TOOL_DESCRIPTION =
    "Fetch the full body of a memory by its `id`. The system prompt only lists memory titles; call this whenever a listed memory looks relevant to the current task before relying on its contents. " +
    "Returns the title, body, and last-updated timestamp. If you also need to overwrite the memory, follow up with `memory_write` passing the same `id`.";

export function createMemoryReadToolDef(): ToolDefinition<
    MemoryReadInput,
    MemoryReadOutput
> {
    return {
        name: "memory_read",
        description: TOOL_DESCRIPTION,
        inputSchema: memoryReadInputSchema,
        execute: executeMemoryRead
    };
}

export const memoryReadToolDef: ToolDefinition<
    MemoryReadInput,
    MemoryReadOutput
> = createMemoryReadToolDef();
