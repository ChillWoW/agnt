import { z } from "zod";

export const toolPermissionDecisionSchema = z.enum(["ask", "allow", "deny"]);

export const ALLOW_BY_DEFAULT_TOOL_NAMES = [
    "read_file",
    "glob",
    "grep",
    "use_skill"
] as const;

export function getDefaultToolPermissionDecision(
    toolName: string
): ToolPermissionDecision {
    return ALLOW_BY_DEFAULT_TOOL_NAMES.includes(
        toolName as (typeof ALLOW_BY_DEFAULT_TOOL_NAMES)[number]
    )
        ? "allow"
        : "ask";
}

export function getDefaultToolPermissionSettings(): ToolPermissionsSettings {
    return {
        defaults: Object.fromEntries(
            ALLOW_BY_DEFAULT_TOOL_NAMES.map((toolName) => [toolName, "allow"])
        )
    };
}

export const toolPermissionsSettingsSchema = z.object({
    defaults: z.record(z.string(), toolPermissionDecisionSchema).default({})
});

export const settingsSchema = z.object({
    hotkeys: z
        .object({
            bindings: z.record(z.string(), z.union([z.string(), z.null()])).default({})
        })
        .default({
            bindings: {}
        }),
    toolPermissions: toolPermissionsSettingsSchema.default(
        getDefaultToolPermissionSettings()
    )
});

export type HotkeySettings = z.infer<typeof settingsSchema.shape.hotkeys>;
export type ToolPermissionDecision = z.infer<typeof toolPermissionDecisionSchema>;
export type ToolPermissionsSettings = z.infer<typeof toolPermissionsSettingsSchema>;
export type Settings = z.infer<typeof settingsSchema>;
export type SettingsCategory = keyof Settings;

export const SETTINGS_CATEGORIES: SettingsCategory[] = [
    "hotkeys",
    "toolPermissions"
] as const;

export const DEFAULT_SETTINGS: Settings = {
    hotkeys: {
        bindings: {}
    },
    toolPermissions: getDefaultToolPermissionSettings()
};

export const categorySchemas: Record<SettingsCategory, z.ZodType> = {
    hotkeys: settingsSchema.shape.hotkeys,
    toolPermissions: toolPermissionsSettingsSchema
};
