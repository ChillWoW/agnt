import { create } from "zustand";
import { persist } from "zustand/middleware";

type LeftSidebarState = {
    isCollapsed: boolean;
    toggleSidebar: () => void;
    setCollapsed: (collapsed: boolean) => void;
};

export const useLeftSidebarStore = create<LeftSidebarState>()(
    persist(
        (set) => ({
            isCollapsed: false,
            toggleSidebar: () => set((state) => ({ isCollapsed: !state.isCollapsed })),
            setCollapsed: (collapsed) => set({ isCollapsed: collapsed })
        }),
        { name: "left-sidebar" }
    )
);
