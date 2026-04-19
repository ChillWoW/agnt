import { readFileToolDef, createReadFileToolDef } from "./read-file";
import { globToolDef, createGlobToolDef } from "./glob";
import { grepToolDef, createGrepToolDef } from "./grep";
import { useSkillToolDef, createUseSkillToolDef } from "./use-skill";
import { questionToolDef, createQuestionToolDef } from "./question";
import type { ToolDefinition } from "./types";

export const AGNT_TOOL_DEFS: readonly ToolDefinition[] = [
    readFileToolDef as ToolDefinition,
    globToolDef as ToolDefinition,
    grepToolDef as ToolDefinition,
    useSkillToolDef as ToolDefinition,
    questionToolDef as ToolDefinition
] as const;

export const AGNT_TOOL_DEF_BY_NAME: Record<string, ToolDefinition> =
    Object.fromEntries(
        AGNT_TOOL_DEFS.map((def) => [def.name, def as ToolDefinition])
    );

/**
 * Tools that bypass the permission gate entirely. These tools never appear
 * in the `Tool permissions` settings panel (`GET /tools`) and their calls
 * are never subject to the `ask`/`allow`/`deny` flow or per-session allow
 * caching. Use sparingly — this is for tools that ARE themselves the user
 * interaction (e.g. `question`), not for tools that happen to be safe.
 */
export const UNGATED_TOOL_NAMES = new Set<string>(["question"]);

export function isUngatedTool(toolName: string): boolean {
    return UNGATED_TOOL_NAMES.has(toolName);
}

export type AgntToolName = (typeof AGNT_TOOL_DEFS)[number]["name"];

export {
    readFileToolDef,
    createReadFileToolDef,
    globToolDef,
    createGlobToolDef,
    grepToolDef,
    createGrepToolDef,
    useSkillToolDef,
    createUseSkillToolDef,
    questionToolDef,
    createQuestionToolDef
};
export type { ToolDefinition };
