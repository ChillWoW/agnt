import { z } from "zod";
import { logger } from "../../../lib/logger";
import { upsertMemory, type Memory } from "../../memories";
import type { ToolDefinition, ToolModelOutput } from "./types";

// We accept `id` as an optional string at the schema layer (so models that
// like to send `null` / `""` / a slug don't crash before we can give them
// a useful error message), then normalize and validate inside `execute`:
//
//   - missing / `null` / empty / whitespace  → CREATE a new memory
//   - valid UUID                              → UPDATE that memory
//   - anything else (slug, "new", non-UUID)   → throw a clear error so the
//                                               LLM learns to either omit
//                                               the field or pass a real
//                                               UUID from the index
//
// This matches what we saw in practice: the model would call
// `memory_write` with `id: ""`, `id: "new"`, or `id: "prefer-bun-over-npm"`
// and then loop on errors instead of just creating a new memory.

const UUID_REGEX =
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export const memoryWriteInputSchema = z.object({
    id: z
        .string()
        .nullish()
        .describe(
            "UUID of an existing memory to overwrite (e.g. `7c3a91b4-...`). To CREATE a brand-new memory, OMIT this field entirely — do NOT invent slugs like `new`, `prefer-bun-over-npm`, or all-zero UUIDs. The only valid values are UUIDs shown in the system-prompt memory index or returned by a previous `memory_write` call. Empty string / null is treated as omitted."
        ),
    title: z
        .string()
        .min(1)
        .max(200)
        .describe(
            "Short title for this memory (≤80 chars is ideal). Shown in the system-prompt memory index across every future conversation, so make it specific and self-explanatory."
        ),
    body: z
        .string()
        .min(1)
        .describe(
            "Free-form markdown body. This is the actual content fetched by `memory_read` when a future turn decides the memory is relevant. Be explicit and self-contained — future you will only see what you wrote here."
        )
});

export type MemoryWriteInput = z.infer<typeof memoryWriteInputSchema>;

export interface MemoryWriteOutput {
    ok: true;
    created: boolean;
    memory: Memory;
}

function normalizeMemoryWriteId(rawId: string | null | undefined): string | undefined {
    if (rawId === null || rawId === undefined) return undefined;
    const trimmed = rawId.trim();
    if (trimmed.length === 0) return undefined;
    if (!UUID_REGEX.test(trimmed)) {
        throw new Error(
            `Invalid \`id\` argument: "${rawId}". The \`id\` field must be a UUID copied from the system-prompt memory index or returned by a previous \`memory_write\` call. To create a NEW memory, omit the \`id\` field entirely (do not pass slugs like "new" or all-zero UUIDs).`
        );
    }
    return trimmed;
}

async function executeMemoryWrite(
    input: MemoryWriteInput
): Promise<MemoryWriteOutput> {
    const id = normalizeMemoryWriteId(input.id);

    const { memory, created } = upsertMemory({
        id,
        title: input.title,
        body: input.body
    });

    logger.log("[tool:memory_write]", {
        id: memory.id,
        created,
        titleLength: memory.title.length,
        bodyLength: memory.body.length
    });

    return { ok: true, created, memory };
}

function toModelOutput({
    output
}: {
    input: MemoryWriteInput;
    output: MemoryWriteOutput;
}): ToolModelOutput {
    const action = output.created ? "Created" : "Updated";
    return {
        type: "text",
        value: `${action} memory \`${output.memory.id}\` ("${output.memory.title}").`
    };
}

const TOOL_DESCRIPTION =
    "Persist a fact you want to remember across ALL future conversations. Memories are global (not scoped to this workspace) and only YOU (the LLM) can read or write them. " +
    "TO CREATE A NEW MEMORY: do NOT include the `id` field at all (just send `title` + `body`). The server will generate a UUID for you. " +
    "TO UPDATE AN EXISTING MEMORY: pass the existing `id` exactly as it appears in the system-prompt memory index — it must be a real UUID. " +
    "Never invent an `id` value (no slugs like \"new\" or \"prefer-bun\", no all-zero UUIDs) — the call will fail. If you're not sure, omit `id` and create a fresh memory. " +
    "Use this for durable, cross-conversation knowledge — user preferences, project conventions you keep relearning, repeated decisions, recurring quirks. " +
    "Do NOT use this for turn-local scratch work (use `todo_write` for that) or for things the user explicitly told you not to remember. " +
    "Keep titles short and specific so the memory index stays scannable; put detail in the body. " +
    "When updating, the title and body are fully replaced — pass the complete new title/body, not a diff.";

export function createMemoryWriteToolDef(): ToolDefinition<
    MemoryWriteInput,
    MemoryWriteOutput
> {
    return {
        name: "memory_write",
        description: TOOL_DESCRIPTION,
        inputSchema: memoryWriteInputSchema,
        execute: executeMemoryWrite,
        toModelOutput
    };
}

export const memoryWriteToolDef: ToolDefinition<
    MemoryWriteInput,
    MemoryWriteOutput
> = createMemoryWriteToolDef();
