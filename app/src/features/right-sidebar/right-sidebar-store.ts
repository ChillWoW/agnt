import { create } from "zustand";
import { persist } from "zustand/middleware";

const MIN_WIDTH = 200;
const DEFAULT_WIDTH = 320;

type RightSidebarState = {
    isCollapsed: boolean;
    width: number;
    toggleSidebar: () => void;
    setCollapsed: (collapsed: boolean) => void;
    setWidth: (width: number) => void;
};

export const useRightSidebarStore = create<RightSidebarState>()(
    persist(
        (set) => ({
            isCollapsed: true,
            width: DEFAULT_WIDTH,
            toggleSidebar: () =>
                set((state) => ({ isCollapsed: !state.isCollapsed })),
            setCollapsed: (collapsed) => set({ isCollapsed: collapsed }),
            setWidth: (width) => set({ width: Math.max(MIN_WIDTH, width) })
        }),
        { name: "right-sidebar" }
    )
);

export { MIN_WIDTH };
