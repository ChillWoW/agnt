import { useEffect, useMemo } from "react";
import { ListIcon } from "@phosphor-icons/react";
import {
    TerminalSidebar,
    TerminalView,
    useTerminalStore,
    ensureSession
} from "../terminals";
import { useWorkspaceStore } from "@/features/workspaces";
import { cn } from "@/lib/cn";

export function TerminalsTab() {
    const toggleSidebar = useTerminalStore((s) => s.toggleSidebar);
    const addTerminal = useTerminalStore((s) => s.addTerminal);
    const setActive = useTerminalStore((s) => s.setActive);

    const workspaces = useWorkspaceStore((s) => s.workspaces);
    const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);

    const workspace = useMemo(
        () => workspaces.find((w) => w.id === activeWorkspaceId) ?? null,
        [workspaces, activeWorkspaceId]
    );

    const terminals = useTerminalStore((s) =>
        activeWorkspaceId
            ? (s.terminalsByWorkspace[activeWorkspaceId] ?? [])
            : []
    );

    const persistedActiveId = useTerminalStore((s) =>
        activeWorkspaceId ? s.activeIdByWorkspace[activeWorkspaceId] : null
    );

    const activeId = useMemo(() => {
        if (!terminals.length) return null;
        if (
            persistedActiveId &&
            terminals.some((t) => t.id === persistedActiveId)
        ) {
            return persistedActiveId;
        }
        return terminals[terminals.length - 1]?.id ?? null;
    }, [terminals, persistedActiveId]);

    const activeDescriptor = useMemo(
        () => terminals.find((t) => t.id === activeId) ?? null,
        [terminals, activeId]
    );

    useEffect(() => {
        if (!workspace) return;
        if (terminals.length === 0) {
            addTerminal(workspace.id, workspace.path);
        }
    }, [workspace, terminals.length, addTerminal]);

    useEffect(() => {
        if (!activeWorkspaceId) return;
        if (!persistedActiveId && activeId) {
            setActive(activeWorkspaceId, activeId);
        }
    }, [activeWorkspaceId, persistedActiveId, activeId, setActive]);

    useEffect(() => {
        for (const descriptor of terminals) {
            ensureSession(descriptor);
        }
    }, [terminals]);

    if (!workspace || !activeWorkspaceId) {
        return (
            <div className="relative flex flex-1 items-center justify-center text-dark-300 text-xs select-none">
                Select a workspace to open a terminal
            </div>
        );
    }

    return (
        <div className="flex flex-col flex-1 overflow-hidden min-h-0">
            <div className="flex items-center gap-2 px-2.5 h-7 shrink-0 border-b border-dark-700">
                <button
                    type="button"
                    onClick={toggleSidebar}
                    className={cn(
                        "flex size-5 items-center justify-center rounded text-dark-300 hover:bg-dark-800 hover:text-dark-100 transition-colors"
                    )}
                >
                    <ListIcon className="size-3.5" />
                </button>

                <span className="text-[11px] text-dark-200">
                    {activeDescriptor?.name}
                </span>
            </div>

            <div className="flex flex-1 overflow-hidden min-h-0">
                <TerminalSidebar
                    workspaceId={activeWorkspaceId}
                    workspacePath={workspace.path}
                    terminals={terminals}
                    activeId={activeId}
                />
                <TerminalView descriptor={activeDescriptor} />
            </div>
        </div>
    );
}
