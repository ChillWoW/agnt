import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { getHomePath } from "../../lib/homedir";
import {
    settingsSchema,
    DEFAULT_SETTINGS,
    DEFAULT_NOTIFICATIONS_SETTINGS,
    getDefaultToolPermissionSettings,
    type Settings,
    type SettingsCategory
} from "./settings.types";

const SETTINGS_PATH = getHomePath("settings.json");

function ensureDir(): void {
    try {
        mkdirSync(dirname(SETTINGS_PATH), { recursive: true });
    } catch {
        // directory already exists
    }
}

function normalizeSettings(settings: Settings): Settings {
    return {
        ...settings,
        hotkeys: {
            bindings: {
                ...DEFAULT_SETTINGS.hotkeys.bindings,
                ...settings.hotkeys.bindings
            }
        },
        toolPermissions: {
            defaults: {
                ...getDefaultToolPermissionSettings().defaults,
                ...settings.toolPermissions.defaults
            }
        },
        notifications: {
            ...DEFAULT_NOTIFICATIONS_SETTINGS,
            ...settings.notifications
        }
    };
}

export function loadSettings(): Settings {
    try {
        const raw = readFileSync(SETTINGS_PATH, "utf8");
        const json = JSON.parse(raw);
        const result = settingsSchema.safeParse(json);

        if (result.success) {
            const normalized = normalizeSettings(result.data);

            if (JSON.stringify(normalized) !== JSON.stringify(json)) {
                saveSettings(normalized);
            }

            return normalized;
        }

        const patched = normalizeSettings(settingsSchema.parse(json));
        saveSettings(patched);
        return patched;
    } catch {
        ensureDir();
        saveSettings(DEFAULT_SETTINGS);
        return DEFAULT_SETTINGS;
    }
}

export function saveSettings(settings: Settings): void {
    ensureDir();
    const json = JSON.stringify(settings, null, 4);
    writeFileSync(SETTINGS_PATH, json, "utf8");
}

export function getCategory<K extends SettingsCategory>(
    category: K
): Settings[K] {
    const settings = loadSettings();
    return settings[category];
}

export function updateCategory<K extends SettingsCategory>(
    category: K,
    partial: Partial<Settings[K]>
): Settings[K] {
    const settings = loadSettings();
    const current = settings[category];
    const merged = { ...current, ...partial };

    settings[category] = merged;

    const validated = settingsSchema.parse(settings);
    saveSettings(validated);

    return validated[category];
}
