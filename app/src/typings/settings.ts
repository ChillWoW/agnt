export type GeneralSettings = {
    launchAtStartup: boolean;
    minimizeToTray: boolean;
    confirmOnClose: boolean;
};

export type Settings = {
    general: GeneralSettings;
};

export type SettingsCategory = keyof Settings;

export const DEFAULT_SETTINGS: Settings = {
    general: {
        launchAtStartup: false,
        minimizeToTray: false,
        confirmOnClose: true
    }
};
