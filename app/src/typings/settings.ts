export type HotkeySettings = {
    bindings: Partial<Record<string, string | null>>;
};

export type ToolPermissionDecision = "ask" | "allow" | "deny";

export type ToolPermissionsSettings = {
    defaults: Partial<Record<string, ToolPermissionDecision>>;
};

export const ALLOW_BY_DEFAULT_TOOL_NAMES = [
    "read_file",
    "glob",
    "grep",
    "use_skill",
    "diagnostics"
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

export type NotificationsSettings = {
    enabled: boolean;
    soundEnabled: boolean;
    osNotificationsEnabled: boolean;
};

export const DEFAULT_NOTIFICATIONS_SETTINGS: NotificationsSettings = {
    enabled: true,
    soundEnabled: true,
    osNotificationsEnabled: true
};

export type DiagnosticsSeverity = "error" | "warning" | "info" | "hint";

export type DiagnosticsSettings = {
    enabled: boolean;
    autoRunOnEdits: boolean;
    minSeverity: DiagnosticsSeverity;
    waitMs: number;
};

export const DEFAULT_DIAGNOSTICS_SETTINGS: DiagnosticsSettings = {
    enabled: true,
    autoRunOnEdits: true,
    minSeverity: "warning",
    waitMs: 1500
};

export type Settings = {
    hotkeys: HotkeySettings;
    toolPermissions: ToolPermissionsSettings;
    notifications: NotificationsSettings;
    diagnostics: DiagnosticsSettings;
};

export type SettingsCategory = keyof Settings;

export const DEFAULT_SETTINGS: Settings = {
    hotkeys: {
        bindings: {}
    },
    toolPermissions: getDefaultToolPermissionSettings(),
    notifications: DEFAULT_NOTIFICATIONS_SETTINGS,
    diagnostics: DEFAULT_DIAGNOSTICS_SETTINGS
};
