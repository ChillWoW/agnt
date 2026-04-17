export type GeneralSettings = {
    launchAtStartup: boolean;
    minimizeToTray: boolean;
    confirmOnClose: boolean;
};

export type HotkeySettings = {
    bindings: Partial<Record<string, string | null>>;
};

export type ToolPermissionDecision = "ask" | "allow" | "deny";

export type ToolPermissionsSettings = {
    defaults: Partial<Record<string, ToolPermissionDecision>>;
};

export type Settings = {
    general: GeneralSettings;
    hotkeys: HotkeySettings;
    toolPermissions: ToolPermissionsSettings;
};

export type SettingsCategory = keyof Settings;

export const DEFAULT_SETTINGS: Settings = {
    general: {
        launchAtStartup: false,
        minimizeToTray: false,
        confirmOnClose: true
    },
    hotkeys: {
        bindings: {}
    },
    toolPermissions: {
        defaults: {}
    }
};
