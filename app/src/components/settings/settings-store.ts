import { create } from "zustand";

type SettingsState = {
    isOpen: boolean;
    activeCategory: string;
    open: () => void;
    close: () => void;
    toggle: () => void;
    setActiveCategory: (category: string) => void;
};

export const useSettingsStore = create<SettingsState>()((set) => ({
    isOpen: false,
    activeCategory: "hotkeys",
    open: () => set({ isOpen: true }),
    close: () => set({ isOpen: false }),
    toggle: () => set((state) => ({ isOpen: !state.isOpen })),
    setActiveCategory: (category) => set({ activeCategory: category })
}));
