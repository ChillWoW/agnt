import { create } from "zustand";
import { persist } from "zustand/middleware";

type LeftSidebarState = {
    isCollapsed: boolean;
    toggleSidebar: () => void;
    setCollapsed: (collapsed: boolean) => void;
    workspaceOrder: string[];
    setWorkspaceOrder: (order: string[]) => void;
};

export const useLeftSidebarStore = create<LeftSidebarState>()(
    persist(
        (set) => ({
            isCollapsed: false,
            toggleSidebar: () => set((state) => ({ isCollapsed: !state.isCollapsed })),
            setCollapsed: (collapsed) => set({ isCollapsed: collapsed }),
            workspaceOrder: [],
            setWorkspaceOrder: (order) => set({ workspaceOrder: order })
        }),
        { name: "left-sidebar" }
    )
);
