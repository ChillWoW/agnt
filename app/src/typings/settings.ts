export type HotkeySettings = {
    bindings: Partial<Record<string, string | null>>;
};

export type ToolPermissionDecision = "ask" | "allow" | "deny";

export type ToolPermissionsSettings = {
    defaults: Partial<Record<string, ToolPermissionDecision>>;
};

export type Settings = {
    hotkeys: HotkeySettings;
    toolPermissions: ToolPermissionsSettings;
};

export type SettingsCategory = keyof Settings;

export const DEFAULT_SETTINGS: Settings = {
    hotkeys: {
        bindings: {}
    },
    toolPermissions: {
        defaults: {}
    }
};
