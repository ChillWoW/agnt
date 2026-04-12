import { create } from "zustand";
import { api, toApiErrorMessage } from "@/lib/api";
import {
    DEFAULT_SETTINGS,
    type Settings,
    type SettingsCategory
} from "@/typings/settings";

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
            const data = await api.get<Settings>("/settings");
            set({ settings: data, isLoading: false, hasFetched: true });
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
            set({
                settings: previous,
                error: toApiErrorMessage(error, "Failed to save settings")
            });
        }
    }
}));
