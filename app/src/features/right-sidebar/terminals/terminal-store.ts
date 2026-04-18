import { create } from "zustand";

export interface Terminal {
    id: string;
}

interface TerminalStore {
    terminals: Terminal[];
    activeId: string | null;
    sidebarOpen: boolean;
    addTerminal: () => void;
    closeTerminal: (id: string) => void;
    setActive: (id: string) => void;
    toggleSidebar: () => void;
}

let nextId = 1;

export const useTerminalStore = create<TerminalStore>((set) => ({
    terminals: [{ id: "1" }],
    activeId: "1",
    sidebarOpen: true,
    addTerminal: () => {
        const id = String(++nextId);
        set((s) => ({
            terminals: [...s.terminals, { id }],
            activeId: id,
        }));
    },
    closeTerminal: (id) => {
        set((s) => {
            const terminals = s.terminals.filter((t) => t.id !== id);
            const activeId =
                s.activeId === id
                    ? (terminals[terminals.length - 1]?.id ?? null)
                    : s.activeId;
            return { terminals, activeId };
        });
    },
    setActive: (id) => set({ activeId: id }),
    toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
}));
