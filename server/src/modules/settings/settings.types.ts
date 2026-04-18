import { z } from "zod";

export const toolPermissionDecisionSchema = z.enum(["ask", "allow", "deny"]);

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
    toolPermissions: toolPermissionsSettingsSchema.default({
        defaults: {}
    })
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

export const DEFAULT_SETTINGS: Settings = settingsSchema.parse({});

export const categorySchemas: Record<SettingsCategory, z.ZodType> = {
    hotkeys: settingsSchema.shape.hotkeys,
    toolPermissions: toolPermissionsSettingsSchema
};
