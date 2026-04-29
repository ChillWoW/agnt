import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { BrowserTabDescriptor } from "./browser-types";

function newId(): string {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
        return crypto.randomUUID();
    }
    return `b-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

interface BrowserStoreState {
    tabs: BrowserTabDescriptor[];
    loadingByTabId: Record<string, boolean>;

    addTab: (initialUrl?: string) => BrowserTabDescriptor;
    closeTab: (id: string) => string | null;
    setUrl: (id: string, url: string) => void;
    setTitle: (id: string, title: string) => void;
    setFavicon: (id: string, favicon: string) => void;
    setLoading: (id: string, isLoading: boolean) => void;
    getTab: (id: string) => BrowserTabDescriptor | undefined;
    hasTab: (id: string) => boolean;
}

export const useBrowserStore = create<BrowserStoreState>()(
    persist(
        (set, get) => ({
            tabs: [],
            loadingByTabId: {},

            addTab: (initialUrl) => {
                const descriptor: BrowserTabDescriptor = {
                    id: newId(),
                    url: initialUrl ?? "",
                    title: "New tab",
                    favicon: "",
                    createdAt: new Date().toISOString()
                };
                set((s) => ({ tabs: [...s.tabs, descriptor] }));
                return descriptor;
            },

            closeTab: (id) => {
                const { tabs } = get();
                const idx = tabs.findIndex((t) => t.id === id);
                if (idx === -1) return null;
                const nextTabs = tabs.filter((t) => t.id !== id);
                const neighborIdx = Math.min(idx, nextTabs.length - 1);
                const neighborId = nextTabs[neighborIdx]?.id ?? null;
                set((s) => {
                    const nextLoading = { ...s.loadingByTabId };
                    delete nextLoading[id];
                    return { tabs: nextTabs, loadingByTabId: nextLoading };
                });
                return neighborId;
            },

            setUrl: (id, url) =>
                set((s) => ({
                    tabs: s.tabs.map((t) =>
                        t.id === id ? { ...t, url } : t
                    )
                })),

            setTitle: (id, title) =>
                set((s) => ({
                    tabs: s.tabs.map((t) =>
                        t.id === id ? { ...t, title } : t
                    )
                })),

            setFavicon: (id, favicon) =>
                set((s) => ({
                    tabs: s.tabs.map((t) =>
                        t.id === id ? { ...t, favicon } : t
                    )
                })),

            setLoading: (id, isLoading) =>
                set((s) => ({
                    loadingByTabId: { ...s.loadingByTabId, [id]: isLoading }
                })),

            getTab: (id) => get().tabs.find((t) => t.id === id),
            hasTab: (id) => get().tabs.some((t) => t.id === id)
        }),
        {
            name: "right-sidebar-browser",
            storage: createJSONStorage(() => localStorage),
            partialize: (state) => ({ tabs: state.tabs })
        }
    )
);

export function getTab(id: string): BrowserTabDescriptor | undefined {
    return useBrowserStore.getState().getTab(id);
}
