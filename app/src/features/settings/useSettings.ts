import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { useSettingsStore } from "./store";
import type { Settings, SettingsCategory } from "@/typings/settings";

export function useSettings() {
    const { settings, isLoading, error, hasFetched, fetchSettings, updateCategory } =
        useSettingsStore(
            useShallow((s) => ({
                settings: s.settings,
                isLoading: s.isLoading,
                error: s.error,
                hasFetched: s.hasFetched,
                fetchSettings: s.fetchSettings,
                updateCategory: s.updateCategory
            }))
        );

    useEffect(() => {
        if (!hasFetched) {
            void fetchSettings();
        }
    }, [hasFetched, fetchSettings]);

    return { settings, isLoading, error, updateCategory };
}

export function useSettingsCategory<K extends SettingsCategory>(category: K) {
    const categorySettings = useSettingsStore(
        (s) => s.settings[category]
    ) as Settings[K];

    const { isLoading, error, hasFetched, fetchSettings, updateCategory } =
        useSettingsStore(
            useShallow((s) => ({
                isLoading: s.isLoading,
                error: s.error,
                hasFetched: s.hasFetched,
                fetchSettings: s.fetchSettings,
                updateCategory: s.updateCategory
            }))
        );

    useEffect(() => {
        if (!hasFetched) {
            void fetchSettings();
        }
    }, [hasFetched, fetchSettings]);

    const update = (partial: Partial<Settings[K]>) =>
        updateCategory(category, partial);

    return { settings: categorySettings, isLoading, error, update };
}
