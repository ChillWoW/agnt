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
    createDiagnosticsToolDef,
    createGlobToolDef,
    createGrepToolDef,
    createImageGenToolDef,
    createQuestionToolDef,
    createReadFileToolDef,
    createApplyPatchToolDef,
    createShellToolDef,
    createStrReplaceToolDef,
    createTaskToolDef,
    createTodoWriteToolDef,
    createUseSkillToolDef,
    createWriteToolDef,
    createWritePlanToolDef,
    isUngatedTool,
    type ToolDefinition
} from "../tools";
import type { ToolExecuteContext } from "../tools/types";
import type { Skill } from "../../skills/skills.service";
import type { SubagentType } from "../conversations.types";
import { getSubagentTypeConfig } from "../subagents/subagent-types";
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
    "web_fetch",
    "task",
    "diagnostics",
    "memory_read"
]);

export interface ConversationPermissionContext {
    conversationId: string;
    workspaceId: string;
    getMode: () => PermissionMode;
    getAgenticMode?: () => AgenticMode;
    workspacePath?: string;
    getSkills?: () => Skill[];
    getAssistantMessageId?: () => string;
    /**
     * When set, this conversation is a subagent stream. Its tool set is
     * filtered against the subagent-type allowlist, and the `task` tool is
     * ALWAYS excluded so subagents cannot recursively spawn more subagents.
     */
    subagentType?: SubagentType;
    /**
     * When set, this conversation is a regular (non-subagent) run that MAY
     * spawn subagents via the `task` tool. Used to wire
     * `createTaskToolDef` with the parent context.
     */
    getParentAbortSignal?: () => AbortSignal | undefined;
    /**
     * Pre-resolved MCP tool definitions for this workspace. The stream
     * layer calls `mcpService.getMcpToolDefs(workspaceId)` once before
     * building tools so all servers connect together up front. MCP tools
     * are blocked in plan mode and for subagents to keep restricted
     * contexts free of third-party side effects.
     */
    mcpTools?: ToolDefinition[];
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
    const subagentType = ctx.subagentType;
    const subagentAllowed = subagentType
        ? new Set(getSubagentTypeConfig(subagentType).allowedTools)
        : null;

    const filteredDefs = AGNT_TOOL_DEFS.filter((def) => {
        // Subagents: strictly filter against the type's allowlist and
        // ALWAYS exclude the `task` tool (no nested subagents).
        if (subagentAllowed) {
            if (def.name === "task") return false;
            return subagentAllowed.has(def.name);
        }
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
            case "task":
                return createTaskToolDef({
                    workspaceId: ctx.workspaceId,
                    parentConversationId: ctx.conversationId,
                    getParentAbortSignal:
                        ctx.getParentAbortSignal ?? (() => undefined)
                }) as ToolDefinition;
            case "diagnostics":
                return createDiagnosticsToolDef(
                    ctx.workspacePath
                ) as ToolDefinition;
            default:
                return rawDef;
        }
    });

    // Append MCP tools after the built-ins. They are gated through the
    // same `withPermission` wrapper as everything else, so the existing
    // permission card / settings flow handles them with no extra UI.
    // Restricted contexts (plan mode, subagents) intentionally skip MCP
    // tools — third-party tools have unbounded side effects and shouldn't
    // run in a research-only or restricted-by-type stream.
    const allowMcp = !subagentAllowed && agenticMode !== "plan";
    if (allowMcp && ctx.mcpTools) {
        for (const mcpDef of ctx.mcpTools) {
            defs.push(mcpDef);
        }
    }

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
