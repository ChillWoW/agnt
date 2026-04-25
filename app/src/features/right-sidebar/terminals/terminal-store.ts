import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { TerminalDescriptor } from "./terminal-types";

const SCROLLBACK_LIMIT = 256 * 1024;

function newId(): string {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
        return crypto.randomUUID();
    }
    return `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

interface TerminalStoreState {
    terminalsByWorkspace: Record<string, TerminalDescriptor[]>;
    activeIdByWorkspace: Record<string, string | null>;
    scrollbackByTerminalId: Record<string, string>;
    sidebarOpen: boolean;

    addTerminal: (workspaceId: string, cwd: string) => TerminalDescriptor;
    closeTerminal: (workspaceId: string, id: string) => void;
    setActive: (workspaceId: string, id: string) => void;
    appendScrollback: (id: string, chunk: string) => void;
    setSidebarOpen: (open: boolean) => void;
    toggleSidebar: () => void;
    renameTerminal: (workspaceId: string, id: string, name: string) => void;
}

function nextTerminalName(existing: TerminalDescriptor[]): string {
    let n = 1;
    const used = new Set(existing.map((t) => t.name));
    while (used.has(`Terminal ${n}`)) n += 1;
    return `Terminal ${n}`;
}

function trimScrollback(buf: string, addition: string): string {
    const combined = buf + addition;
    if (combined.length <= SCROLLBACK_LIMIT) return combined;
    return combined.slice(combined.length - SCROLLBACK_LIMIT);
}

export const useTerminalStore = create<TerminalStoreState>()(
    persist(
        (set) => ({
            terminalsByWorkspace: {},
            activeIdByWorkspace: {},
            scrollbackByTerminalId: {},
            sidebarOpen: true,

            addTerminal: (workspaceId, cwd) => {
                const descriptor: TerminalDescriptor = {
                    id: newId(),
                    workspaceId,
                    name: "",
                    cwd,
                    createdAt: new Date().toISOString()
                };
                set((s) => {
                    const existing =
                        s.terminalsByWorkspace[workspaceId] ?? [];
                    descriptor.name = nextTerminalName(existing);
                    return {
                        terminalsByWorkspace: {
                            ...s.terminalsByWorkspace,
                            [workspaceId]: [...existing, descriptor]
                        },
                        activeIdByWorkspace: {
                            ...s.activeIdByWorkspace,
                            [workspaceId]: descriptor.id
                        }
                    };
                });
                return descriptor;
            },

            closeTerminal: (workspaceId, id) => {
                set((s) => {
                    const existing =
                        s.terminalsByWorkspace[workspaceId] ?? [];
                    const filtered = existing.filter((t) => t.id !== id);
                    const nextActive =
                        s.activeIdByWorkspace[workspaceId] === id
                            ? (filtered[filtered.length - 1]?.id ?? null)
                            : s.activeIdByWorkspace[workspaceId] ?? null;

                    const nextScrollback = { ...s.scrollbackByTerminalId };
                    delete nextScrollback[id];

                    return {
                        terminalsByWorkspace: {
                            ...s.terminalsByWorkspace,
                            [workspaceId]: filtered
                        },
                        activeIdByWorkspace: {
                            ...s.activeIdByWorkspace,
                            [workspaceId]: nextActive
                        },
                        scrollbackByTerminalId: nextScrollback
                    };
                });
            },

            setActive: (workspaceId, id) => {
                set((s) => ({
                    activeIdByWorkspace: {
                        ...s.activeIdByWorkspace,
                        [workspaceId]: id
                    }
                }));
            },

            appendScrollback: (id, chunk) => {
                if (chunk.length === 0) return;
                set((s) => ({
                    scrollbackByTerminalId: {
                        ...s.scrollbackByTerminalId,
                        [id]: trimScrollback(
                            s.scrollbackByTerminalId[id] ?? "",
                            chunk
                        )
                    }
                }));
            },

            setSidebarOpen: (open) => set({ sidebarOpen: open }),
            toggleSidebar: () =>
                set((s) => ({ sidebarOpen: !s.sidebarOpen })),

            renameTerminal: (workspaceId, id, name) => {
                set((s) => {
                    const existing =
                        s.terminalsByWorkspace[workspaceId] ?? [];
                    return {
                        terminalsByWorkspace: {
                            ...s.terminalsByWorkspace,
                            [workspaceId]: existing.map((t) =>
                                t.id === id ? { ...t, name } : t
                            )
                        }
                    };
                });
            }
        }),
        {
            name: "right-sidebar-terminals",
            storage: createJSONStorage(() => localStorage),
            partialize: (state) => ({
                terminalsByWorkspace: state.terminalsByWorkspace,
                activeIdByWorkspace: state.activeIdByWorkspace,
                scrollbackByTerminalId: state.scrollbackByTerminalId,
                sidebarOpen: state.sidebarOpen
            })
        }
    )
);

export function getScrollback(id: string): string {
    return useTerminalStore.getState().scrollbackByTerminalId[id] ?? "";
}

export function getTerminalDescriptor(
    workspaceId: string,
    id: string
): TerminalDescriptor | undefined {
    const list =
        useTerminalStore.getState().terminalsByWorkspace[workspaceId] ?? [];
    return list.find((t) => t.id === id);
}
