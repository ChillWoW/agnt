import { z } from "zod";

export const generalSettingsSchema = z.object({
    launchAtStartup: z.boolean().default(false),
    minimizeToTray: z.boolean().default(false),
    confirmOnClose: z.boolean().default(true)
});

export const toolPermissionDecisionSchema = z.enum(["ask", "allow", "deny"]);

export const toolPermissionsSettingsSchema = z.object({
    defaults: z.record(z.string(), toolPermissionDecisionSchema).default({})
});

export const settingsSchema = z.object({
    general: generalSettingsSchema.default({
        launchAtStartup: false,
        minimizeToTray: false,
        confirmOnClose: true
    }),
    toolPermissions: toolPermissionsSettingsSchema.default({
        defaults: {}
    })
});

export type GeneralSettings = z.infer<typeof generalSettingsSchema>;
export type ToolPermissionDecision = z.infer<typeof toolPermissionDecisionSchema>;
export type ToolPermissionsSettings = z.infer<typeof toolPermissionsSettingsSchema>;
export type Settings = z.infer<typeof settingsSchema>;
export type SettingsCategory = keyof Settings;

export const SETTINGS_CATEGORIES: SettingsCategory[] = [
    "general",
    "toolPermissions"
] as const;

export const DEFAULT_SETTINGS: Settings = settingsSchema.parse({});

export const categorySchemas: Record<SettingsCategory, z.ZodType> = {
    general: generalSettingsSchema,
    toolPermissions: toolPermissionsSettingsSchema
};
