import { z } from "zod";

export const toolPermissionDecisionSchema = z.enum(["ask", "allow", "deny"]);

export const ALLOW_BY_DEFAULT_TOOL_NAMES = [
    "read_file",
    "glob",
    "grep",
    "use_skill",
    "diagnostics",
    // Read-only browser tools — safe to run without prompting (mirror
    // the precedent set by `web_fetch`, except those need a network
    // call). `browser_navigate`/`click`/`type`/`screenshot`/`eval` stay
    // on `ask`.
    "browser_list_tabs",
    "browser_read",
    "browser_snapshot",
    "browser_find",
    "browser_get_state"
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

export const diagnosticsSeveritySchema = z.enum([
    "error",
    "warning",
    "info",
    "hint"
]);

export const diagnosticsSettingsSchema = z.object({
    enabled: z.boolean().default(true),
    autoRunOnEdits: z.boolean().default(true),
    minSeverity: diagnosticsSeveritySchema.default("warning"),
    waitMs: z.number().int().min(200).max(10000).default(1500)
});

export const DEFAULT_DIAGNOSTICS_SETTINGS: DiagnosticsSettings = {
    enabled: true,
    autoRunOnEdits: true,
    minSeverity: "warning",
    waitMs: 1500
};

export const generalSettingsSchema = z.object({
    /**
     * When true (default), file-touching tools (glob, grep, write,
     * str_replace, apply_patch, shell, diagnostics) refuse paths that resolve
     * outside the active workspace. When false, those tools accept any
     * absolute path on the host filesystem. `read_file` is unaffected — it
     * has always accepted absolute paths.
     */
    restrictToolsToWorkspace: z.boolean().default(true)
});

export const DEFAULT_GENERAL_SETTINGS: GeneralSettings = {
    restrictToolsToWorkspace: true
};

export const settingsSchema = z.object({
    general: generalSettingsSchema.default(DEFAULT_GENERAL_SETTINGS),
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
    ),
    diagnostics: diagnosticsSettingsSchema.default(
        DEFAULT_DIAGNOSTICS_SETTINGS
    )
});

export type GeneralSettings = z.infer<typeof generalSettingsSchema>;
export type HotkeySettings = z.infer<typeof settingsSchema.shape.hotkeys>;
export type ToolPermissionDecision = z.infer<typeof toolPermissionDecisionSchema>;
export type ToolPermissionsSettings = z.infer<typeof toolPermissionsSettingsSchema>;
export type NotificationsSettings = z.infer<typeof notificationsSettingsSchema>;
export type DiagnosticsSeverity = z.infer<typeof diagnosticsSeveritySchema>;
export type DiagnosticsSettings = z.infer<typeof diagnosticsSettingsSchema>;
export type Settings = z.infer<typeof settingsSchema>;
export type SettingsCategory = keyof Settings;

export const SETTINGS_CATEGORIES: SettingsCategory[] = [
    "general",
    "hotkeys",
    "toolPermissions",
    "notifications",
    "diagnostics"
] as const;

export const DEFAULT_SETTINGS: Settings = {
    general: DEFAULT_GENERAL_SETTINGS,
    hotkeys: {
        bindings: {}
    },
    toolPermissions: getDefaultToolPermissionSettings(),
    notifications: DEFAULT_NOTIFICATIONS_SETTINGS,
    diagnostics: DEFAULT_DIAGNOSTICS_SETTINGS
};

export const categorySchemas: Record<SettingsCategory, z.ZodType> = {
    general: generalSettingsSchema,
    hotkeys: settingsSchema.shape.hotkeys,
    toolPermissions: toolPermissionsSettingsSchema,
    notifications: notificationsSettingsSchema,
    diagnostics: diagnosticsSettingsSchema
};
