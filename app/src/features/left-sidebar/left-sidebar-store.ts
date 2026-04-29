import { create } from "zustand";
import { persist } from "zustand/middleware";

type LeftSidebarState = {
    isCollapsed: boolean;
    toggleSidebar: () => void;
    setCollapsed: (collapsed: boolean) => void;
    workspaceOrder: string[];
    setWorkspaceOrder: (order: string[]) => void;
    /**
     * Collapsed/expanded state of the global "Pinned" group at the top of
     * the sidebar. Persisted so the user's preferred state survives
     * reloads — defaults to expanded so newly-pinned conversations are
     * visible immediately on first paint.
     */
    isPinnedGroupCollapsed: boolean;
    setPinnedGroupCollapsed: (collapsed: boolean) => void;
};

export const useLeftSidebarStore = create<LeftSidebarState>()(
    persist(
        (set) => ({
            isCollapsed: false,
            toggleSidebar: () => set((state) => ({ isCollapsed: !state.isCollapsed })),
            setCollapsed: (collapsed) => set({ isCollapsed: collapsed }),
            workspaceOrder: [],
            setWorkspaceOrder: (order) => set({ workspaceOrder: order }),
            isPinnedGroupCollapsed: false,
            setPinnedGroupCollapsed: (collapsed) =>
                set({ isPinnedGroupCollapsed: collapsed })
        }),
        { name: "left-sidebar" }
    )
);
