import { z } from "zod";
import { logger } from "../../../lib/logger";
import {
    deleteMemory,
    InvalidMemoryIdError,
    MemoryNotFoundError
} from "../../memories";
import type { ToolDefinition, ToolModelOutput } from "./types";

export const memoryDeleteInputSchema = z.object({
    id: z
        .string()
        .describe(
            "Id of the memory to permanently delete. Get this from the system-prompt memory index or from a previous `memory_write` call."
        )
});

export type MemoryDeleteInput = z.infer<typeof memoryDeleteInputSchema>;

export interface MemoryDeleteOutput {
    ok: true;
    id: string;
}

async function executeMemoryDelete(
    input: MemoryDeleteInput
): Promise<MemoryDeleteOutput> {
    try {
        deleteMemory(input.id);
    } catch (error) {
        if (
            error instanceof MemoryNotFoundError ||
            error instanceof InvalidMemoryIdError
        ) {
            throw new Error(error.message);
        }
        throw error;
    }

    logger.log("[tool:memory_delete]", { id: input.id });

    return { ok: true, id: input.id };
}

function toModelOutput({
    output
}: {
    input: MemoryDeleteInput;
    output: MemoryDeleteOutput;
}): ToolModelOutput {
    return {
        type: "text",
        value: `Deleted memory \`${output.id}\`.`
    };
}

const TOOL_DESCRIPTION =
    "Permanently delete a global memory by `id`. Use this when a stored fact is wrong, obsolete, or no longer worth keeping in the always-on memory index. " +
    "Deletion cannot be undone — if you might need the content again, prefer `memory_write` to overwrite it with corrected information instead.";

export function createMemoryDeleteToolDef(): ToolDefinition<
    MemoryDeleteInput,
    MemoryDeleteOutput
> {
    return {
        name: "memory_delete",
        description: TOOL_DESCRIPTION,
        inputSchema: memoryDeleteInputSchema,
        execute: executeMemoryDelete,
        toModelOutput
    };
}

export const memoryDeleteToolDef: ToolDefinition<
    MemoryDeleteInput,
    MemoryDeleteOutput
> = createMemoryDeleteToolDef();
