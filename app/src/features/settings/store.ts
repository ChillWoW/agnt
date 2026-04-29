import { create } from "zustand";
import { api, toApiErrorMessage } from "@/lib/api";
import { toast } from "@/components/ui";
import {
    DEFAULT_SETTINGS,
    type Settings,
    type SettingsCategory
} from "@/typings/settings";

function normalizeSettings(raw: Partial<Settings>): Settings {
    return {
        general: {
            ...DEFAULT_SETTINGS.general,
            ...raw.general
        },
        hotkeys: {
            bindings: {
                ...DEFAULT_SETTINGS.hotkeys.bindings,
                ...raw.hotkeys?.bindings
            }
        },
        toolPermissions: {
            defaults: {
                ...DEFAULT_SETTINGS.toolPermissions.defaults,
                ...raw.toolPermissions?.defaults
            }
        },
        notifications: {
            ...DEFAULT_SETTINGS.notifications,
            ...raw.notifications
        },
        diagnostics: {
            ...DEFAULT_SETTINGS.diagnostics,
            ...raw.diagnostics
        }
    };
}

interface SettingsState {
    settings: Settings;
    isLoading: boolean;
    error: string | null;
    hasFetched: boolean;
    fetchSettings: () => Promise<void>;
    updateCategory: <K extends SettingsCategory>(
        category: K,
        partial: Partial<Settings[K]>
    ) => Promise<void>;
    setHotkeyBinding: (id: string, combo: string | null) => void;
    resetHotkeyBinding: (id: string) => void;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
    settings: DEFAULT_SETTINGS,
    isLoading: false,
    error: null,
    hasFetched: false,

    fetchSettings: async () => {
        if (get().isLoading) return;

        set({ isLoading: true, error: null });

        try {
            const data = await api.get<Partial<Settings>>("/settings");
            set({ settings: normalizeSettings(data), isLoading: false, hasFetched: true });
        } catch (error) {
            set({
                error: toApiErrorMessage(error, "Failed to load settings"),
                isLoading: false,
                hasFetched: true
            });
        }
    },

    updateCategory: async <K extends SettingsCategory>(
        category: K,
        partial: Partial<Settings[K]>
    ) => {
        const previous = get().settings;

        // Optimistic update
        set({
            settings: {
                ...previous,
                [category]: { ...previous[category], ...partial }
            },
            error: null
        });

        try {
            const updated = await api.patch<Settings[K]>(
                `/settings/${category}`,
                { body: partial }
            );

            set({
                settings: {
                    ...get().settings,
                    [category]: updated
                }
            });
        } catch (error) {
            // Rollback on failure
            const message = toApiErrorMessage(error, "Failed to save settings");
            set({
                settings: previous,
                error: message
            });
            toast.error({
                title: "Couldn't save settings",
                description: message
            });
        }
    },

    setHotkeyBinding: (id, combo) => {
        const current = get().settings.hotkeys?.bindings ?? {};
        void get().updateCategory("hotkeys", {
            bindings: { ...current, [id]: combo }
        } as Partial<Settings["hotkeys"]>);
    },

    resetHotkeyBinding: (id) => {
        const current = get().settings.hotkeys?.bindings ?? {};
        const { [id]: _removed, ...bindings } = current;

        void get().updateCategory("hotkeys", {
            bindings
        } as Partial<Settings["hotkeys"]>);
    }
}));
