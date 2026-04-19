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

export type Settings = {
    hotkeys: HotkeySettings;
    toolPermissions: ToolPermissionsSettings;
};

export type SettingsCategory = keyof Settings;

export const DEFAULT_SETTINGS: Settings = {
    hotkeys: {
        bindings: {}
    },
    toolPermissions: getDefaultToolPermissionSettings()
};
