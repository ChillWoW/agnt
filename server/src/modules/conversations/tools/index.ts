import { readFileToolDef, createReadFileToolDef } from "./read-file";
import { globToolDef, createGlobToolDef } from "./glob";
import { grepToolDef, createGrepToolDef } from "./grep";
import { useSkillToolDef, createUseSkillToolDef } from "./use-skill";
import { questionToolDef, createQuestionToolDef } from "./question";
import { todoWriteToolDef, createTodoWriteToolDef } from "./todo-write";
import { imageGenToolDef, createImageGenToolDef } from "./image-gen";
import { webSearchToolDef, createWebSearchToolDef } from "./web-search";
import { webFetchToolDef, createWebFetchToolDef } from "./web-fetch";
import { writeToolDef, createWriteToolDef } from "./write";
import { strReplaceToolDef, createStrReplaceToolDef } from "./str-replace";
import { applyPatchToolDef, createApplyPatchToolDef } from "./apply-patch";
import { shellToolDef, createShellToolDef } from "./shell";
import { awaitShellToolDef, createAwaitShellToolDef } from "./await-shell";
import { writePlanToolDef, createWritePlanToolDef } from "./write-plan";
import { taskToolDef, createTaskToolDef } from "./task";
import type { ToolDefinition } from "./types";

export const AGNT_TOOL_DEFS: readonly ToolDefinition[] = [
    readFileToolDef as ToolDefinition,
    globToolDef as ToolDefinition,
    grepToolDef as ToolDefinition,
    useSkillToolDef as ToolDefinition,
    questionToolDef as ToolDefinition,
    todoWriteToolDef as ToolDefinition,
    imageGenToolDef as ToolDefinition,
    webSearchToolDef as ToolDefinition,
    webFetchToolDef as ToolDefinition,
    writeToolDef as ToolDefinition,
    strReplaceToolDef as ToolDefinition,
    applyPatchToolDef as ToolDefinition,
    shellToolDef as ToolDefinition,
    awaitShellToolDef as ToolDefinition,
    writePlanToolDef as ToolDefinition,
    taskToolDef as ToolDefinition
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
export const UNGATED_TOOL_NAMES = new Set<string>(["question", "todo_write", "write_plan"]);

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
    createQuestionToolDef,
    todoWriteToolDef,
    createTodoWriteToolDef,
    imageGenToolDef,
    createImageGenToolDef,
    webSearchToolDef,
    createWebSearchToolDef,
    webFetchToolDef,
    createWebFetchToolDef,
    writeToolDef,
    createWriteToolDef,
    strReplaceToolDef,
    createStrReplaceToolDef,
    applyPatchToolDef,
    createApplyPatchToolDef,
    shellToolDef,
    createShellToolDef,
    awaitShellToolDef,
    createAwaitShellToolDef,
    writePlanToolDef,
    createWritePlanToolDef,
    taskToolDef,
    createTaskToolDef
};
export type { ToolDefinition };
