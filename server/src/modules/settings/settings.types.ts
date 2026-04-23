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

export const notificationsSettingsSchema = z.object({
    enabled: z.boolean().default(true),
    soundEnabled: z.boolean().default(true),
    osNotificationsEnabled: z.boolean().default(true)
});

export const DEFAULT_NOTIFICATIONS_SETTINGS: NotificationsSettings = {
    enabled: true,
    soundEnabled: true,
    osNotificationsEnabled: true
};

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
    ),
    notifications: notificationsSettingsSchema.default(
        DEFAULT_NOTIFICATIONS_SETTINGS
    )
});

export type HotkeySettings = z.infer<typeof settingsSchema.shape.hotkeys>;
export type ToolPermissionDecision = z.infer<typeof toolPermissionDecisionSchema>;
export type ToolPermissionsSettings = z.infer<typeof toolPermissionsSettingsSchema>;
export type NotificationsSettings = z.infer<typeof notificationsSettingsSchema>;
export type Settings = z.infer<typeof settingsSchema>;
export type SettingsCategory = keyof Settings;

export const SETTINGS_CATEGORIES: SettingsCategory[] = [
    "hotkeys",
    "toolPermissions",
    "notifications"
] as const;

export const DEFAULT_SETTINGS: Settings = {
    hotkeys: {
        bindings: {}
    },
    toolPermissions: getDefaultToolPermissionSettings(),
    notifications: DEFAULT_NOTIFICATIONS_SETTINGS
};

export const categorySchemas: Record<SettingsCategory, z.ZodType> = {
    hotkeys: settingsSchema.shape.hotkeys,
    toolPermissions: toolPermissionsSettingsSchema,
    notifications: notificationsSettingsSchema
};
