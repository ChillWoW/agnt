import { z } from "zod";

export const generalSettingsSchema = z.object({
    launchAtStartup: z.boolean().default(false),
    minimizeToTray: z.boolean().default(false),
    confirmOnClose: z.boolean().default(true)
});

export const settingsSchema = z.object({
    general: generalSettingsSchema.default({
        launchAtStartup: false,
        minimizeToTray: false,
        confirmOnClose: true
    })
});

export type GeneralSettings = z.infer<typeof generalSettingsSchema>;
export type Settings = z.infer<typeof settingsSchema>;
export type SettingsCategory = keyof Settings;

export const SETTINGS_CATEGORIES: SettingsCategory[] = ["general"] as const;

export const DEFAULT_SETTINGS: Settings = settingsSchema.parse({});

export const categorySchemas: Record<SettingsCategory, z.ZodType> = {
    general: generalSettingsSchema
};