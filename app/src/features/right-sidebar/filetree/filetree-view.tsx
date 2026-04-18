import { useEffect } from "react";
import { useWorkspaceStore } from "@/features/workspaces";
import { useFiletreeStore } from "./filetree-store";
import { TreeNode } from "./tree-node";

const POLL_INTERVAL_MS = 5000;

export function FiletreeView() {
    const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
    const setWorkspace = useFiletreeStore((s) => s.setWorkspace);
    const refreshAll = useFiletreeStore((s) => s.refreshAll);
    const rootState = useFiletreeStore((s) => s.directories[""]);

    useEffect(() => {
        setWorkspace(activeWorkspaceId);
    }, [activeWorkspaceId, setWorkspace]);

    useEffect(() => {
        if (!activeWorkspaceId) return;

        const onFocus = () => {
            void refreshAll();
        };

        window.addEventListener("focus", onFocus);
        const intervalId = window.setInterval(() => {
            void refreshAll();
        }, POLL_INTERVAL_MS);

        return () => {
            window.removeEventListener("focus", onFocus);
            window.clearInterval(intervalId);
        };
    }, [activeWorkspaceId, refreshAll]);

    if (!activeWorkspaceId) {
        return (
            <div className="flex flex-1 items-center justify-center px-4 text-center text-xs text-dark-300 select-none">
                No workspace open
            </div>
        );
    }

    const entries = rootState?.entries;
    const isInitialLoading = rootState?.loading && !entries;
    const initialError = rootState?.error && !entries ? rootState.error : null;

    if (isInitialLoading) {
        return (
            <div className="flex flex-1 items-center justify-center text-xs text-dark-300 select-none">
                Loading…
            </div>
        );
    }

    if (initialError) {
        return (
            <div className="flex flex-1 items-center justify-center px-4 text-center text-xs text-red-400/80 select-none">
                {initialError}
            </div>
        );
    }

    return (
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-1">
            {entries && entries.length === 0 ? (
                <div className="py-2 text-center text-xs italic text-dark-400 select-none">
                    empty workspace
                </div>
            ) : (
                entries?.map((entry) => (
                    <TreeNode key={entry.path} entry={entry} depth={0} />
                ))
            )}
        </div>
    );
}
