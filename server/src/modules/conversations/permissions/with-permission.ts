import { tool, type Tool } from "ai";
import { logger } from "../../../lib/logger";
import { getCategory } from "../../settings/settings.service";
import {
    getDefaultToolPermissionDecision,
    type ToolPermissionDecision
} from "../../settings/settings.types";
import {
    AGNT_TOOL_DEFS,
    createAwaitShellToolDef,
    createGlobToolDef,
    createGrepToolDef,
    createImageGenToolDef,
    createQuestionToolDef,
    createReadFileToolDef,
    createApplyPatchToolDef,
    createShellToolDef,
    createStrReplaceToolDef,
    createTodoWriteToolDef,
    createUseSkillToolDef,
    createWriteToolDef,
    createWritePlanToolDef,
    isUngatedTool,
    type ToolDefinition
} from "../tools";
import type { ToolExecuteContext } from "../tools/types";
import type { Skill } from "../../skills/skills.service";
import {
    isSessionAllowed,
    rememberSessionAllow,
    requestPermission
} from "./gate";

export type PermissionMode = "ask" | "bypass";
export type AgenticMode = "agent" | "plan";

const PLAN_MODE_TOOLS = new Set<string>([
    "read_file",
    "glob",
    "grep",
    "use_skill",
    "question",
    "todo_write",
    "shell",
    "await_shell",
    "write_plan",
    "web_search",
    "web_fetch"
]);

export interface ConversationPermissionContext {
    conversationId: string;
    workspaceId: string;
    getMode: () => PermissionMode;
    getAgenticMode?: () => AgenticMode;
    workspacePath?: string;
    getSkills?: () => Skill[];
    getAssistantMessageId?: () => string;
}

function resolveConfiguredDecision(
    toolName: string
): ToolPermissionDecision {
    try {
        const category = getCategory("toolPermissions");
        const value = category.defaults[toolName];
        if (value === "allow" || value === "deny" || value === "ask") {
            return value;
        }
    } catch (error) {
        logger.error("[permissions] failed to load settings", error);
    }
    return getDefaultToolPermissionDecision(toolName);
}

function wrapExecute<TInput extends object, TOutput>(
    def: ToolDefinition<TInput, TOutput>,
    ctx: ConversationPermissionContext
): (input: TInput, toolCtx?: ToolExecuteContext) => Promise<TOutput> {
    return async (input: TInput, toolCtx?: ToolExecuteContext) => {
        // Resolve mode + configured decision fresh on every invocation so
        // toggling the PermissionModeSelector or updating the per-tool
        // setting takes effect immediately, even mid-stream.
        const configured = resolveConfiguredDecision(def.name);
        const mode = ctx.getMode();

        logger.log("[permissions] gate check", {
            tool: def.name,
            mode,
            configured,
            sessionAllowed: isSessionAllowed(ctx.conversationId, def.name)
        });

        if (configured === "deny") {
            throw new Error(
                `Tool "${def.name}" is disabled in settings (set to Always deny).`
            );
        }

        const autoAllow =
            mode === "bypass" ||
            configured === "allow" ||
            isSessionAllowed(ctx.conversationId, def.name);

        if (autoAllow) {
            return def.execute(input, toolCtx);
        }

        const decision = await requestPermission({
            conversationId: ctx.conversationId,
            toolName: def.name,
            input
        });

        if (decision === "deny") {
            throw new Error(
                `User denied permission to run tool "${def.name}".`
            );
        }

        if (decision === "allow_session") {
            rememberSessionAllow(ctx.conversationId, def.name);
        }

        return def.execute(input, toolCtx);
    };
}

export function buildConversationTools(
    ctx: ConversationPermissionContext
): Record<string, Tool> {
    const tools: Record<string, Tool> = {};

    const agenticMode = ctx.getAgenticMode?.() ?? "agent";

    const filteredDefs = AGNT_TOOL_DEFS.filter((def) => {
        if (agenticMode === "plan") {
            return PLAN_MODE_TOOLS.has(def.name);
        }
        // Agent mode: everything except write_plan
        return def.name !== "write_plan";
    });

    const defs = filteredDefs.map((rawDef) => {
        switch (rawDef.name) {
            case "read_file":
                return createReadFileToolDef(
                    ctx.workspacePath
                ) as ToolDefinition;
            case "glob":
                return createGlobToolDef(ctx.workspacePath) as ToolDefinition;
            case "grep":
                return createGrepToolDef(ctx.workspacePath) as ToolDefinition;
            case "use_skill":
                return createUseSkillToolDef(
                    ctx.getSkills ?? (() => [])
                ) as ToolDefinition;
            case "question":
                return createQuestionToolDef({
                    conversationId: ctx.conversationId
                }) as ToolDefinition;
            case "todo_write":
                return createTodoWriteToolDef({
                    workspaceId: ctx.workspaceId,
                    conversationId: ctx.conversationId
                }) as ToolDefinition;
            case "image_gen":
                return createImageGenToolDef({
                    workspaceId: ctx.workspaceId,
                    conversationId: ctx.conversationId,
                    getAssistantMessageId:
                        ctx.getAssistantMessageId ?? (() => "")
                }) as ToolDefinition;
            case "write":
                return createWriteToolDef(ctx.workspacePath) as ToolDefinition;
            case "str_replace":
                return createStrReplaceToolDef(
                    ctx.workspacePath
                ) as ToolDefinition;
            case "apply_patch":
                return createApplyPatchToolDef(
                    ctx.workspacePath
                ) as ToolDefinition;
            case "shell":
                return createShellToolDef({
                    workspacePath: ctx.workspacePath,
                    conversationId: ctx.conversationId,
                    workspaceId: ctx.workspaceId,
                    getAssistantMessageId:
                        ctx.getAssistantMessageId ?? (() => "")
                }) as ToolDefinition;
            case "await_shell":
                return createAwaitShellToolDef({
                    conversationId: ctx.conversationId,
                    workspaceId: ctx.workspaceId,
                    getAssistantMessageId:
                        ctx.getAssistantMessageId ?? (() => "")
                }) as ToolDefinition;
            case "write_plan":
                return createWritePlanToolDef({
                    workspaceId: ctx.workspaceId,
                    conversationId: ctx.conversationId
                }) as ToolDefinition;
            default:
                return rawDef;
        }
    });

    for (const rawDef of defs) {
        const def = rawDef as ToolDefinition<object, unknown>;
        const execute = isUngatedTool(def.name)
            ? def.execute
            : wrapExecute(def, ctx);

        const customToModelOutput = def.toModelOutput;
        const toModelOutputAdapter = customToModelOutput
            ? async ({
                  input,
                  output
              }: {
                  input: unknown;
                  output: unknown;
              }) => {
                  const result = await customToModelOutput({
                      input: input as object,
                      output
                  });
                  return result;
              }
            : undefined;

        // Adapter that relays the AI SDK's ToolCallOptions (toolCallId,
        // abortSignal, messages) into our ToolDefinition.execute(input, ctx)
        // contract. Tools that don't care about ctx ignore the second arg.
        const executeAdapter = async (
            input: object,
            options?: { toolCallId?: string; abortSignal?: AbortSignal; messages?: unknown }
        ): Promise<unknown> => {
            const toolCtx: ToolExecuteContext = {
                toolCallId: options?.toolCallId,
                abortSignal: options?.abortSignal,
                messages: options?.messages
            };
            return execute(input, toolCtx);
        };

        tools[def.name] = tool({
            description: def.description,
            inputSchema: def.inputSchema,
            execute: executeAdapter as never,
            ...(toModelOutputAdapter
                ? { toModelOutput: toModelOutputAdapter as never }
                : {})
        });
    }

    return tools;
}
