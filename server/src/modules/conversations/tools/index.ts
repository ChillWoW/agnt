import { readFileToolDef, createReadFileToolDef } from "./read-file";
import type { ToolDefinition } from "./types";

export const AGNT_TOOL_DEFS: readonly ToolDefinition[] = [
    readFileToolDef as ToolDefinition
] as const;

export const AGNT_TOOL_DEF_BY_NAME: Record<string, ToolDefinition> =
    Object.fromEntries(
        AGNT_TOOL_DEFS.map((def) => [def.name, def as ToolDefinition])
    );

export type AgntToolName = (typeof AGNT_TOOL_DEFS)[number]["name"];

export { readFileToolDef, createReadFileToolDef };
export type { ToolDefinition };
