import { tool, type Tool } from "ai";
import { logger } from "../../../lib/logger";
import { getCategory } from "../../settings/settings.service";
import {
    getDefaultToolPermissionDecision,
    type ToolPermissionDecision
} from "../../settings/settings.types";
import {
    AGNT_TOOL_DEFS,
    createGlobToolDef,
    createGrepToolDef,
    createQuestionToolDef,
    createReadFileToolDef,
    createUseSkillToolDef,
    isUngatedTool,
    type ToolDefinition
} from "../tools";
import type { Skill } from "../../skills/skills.service";
import {
    isSessionAllowed,
    rememberSessionAllow,
    requestPermission
} from "./gate";

export type PermissionMode = "ask" | "bypass";

export interface ConversationPermissionContext {
    conversationId: string;
    getMode: () => PermissionMode;
    workspacePath?: string;
    getSkills?: () => Skill[];
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
): (input: TInput) => Promise<TOutput> {
    return async (input: TInput) => {
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
            return def.execute(input);
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

        return def.execute(input);
    };
}

export function buildConversationTools(
    ctx: ConversationPermissionContext
): Record<string, Tool> {
    const tools: Record<string, Tool> = {};

    const defs = AGNT_TOOL_DEFS.map((rawDef) => {
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
            default:
                return rawDef;
        }
    });

    for (const rawDef of defs) {
        const def = rawDef as ToolDefinition<object, unknown>;
        const execute = isUngatedTool(def.name)
            ? def.execute
            : wrapExecute(def, ctx);

        tools[def.name] = tool({
            description: def.description,
            inputSchema: def.inputSchema,
            execute
        });
    }

    return tools;
}
