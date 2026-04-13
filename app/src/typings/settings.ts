export type GeneralSettings = {
    launchAtStartup: boolean;
    minimizeToTray: boolean;
    confirmOnClose: boolean;
};

export type HotkeySettings = {
    bindings: Partial<Record<string, string | null>>;
};

export type Settings = {
    general: GeneralSettings;
    hotkeys: HotkeySettings;
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
    }
};
