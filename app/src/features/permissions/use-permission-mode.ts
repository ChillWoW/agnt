import { useCallback, useEffect, useState } from "react";
import {
    fetchEffectiveConversationState,
    fetchWorkspaceState,
    updateConversationState,
    updateWorkspaceState
} from "@/features/history";
import type { PermissionMode } from "./types";

interface PermissionModeScope {
    workspaceId?: string | null;
    conversationId?: string | null;
}

function isPermissionMode(value: unknown): value is PermissionMode {
    return value === "ask" || value === "bypass";
}

function toMode(values: Record<string, unknown>): PermissionMode {
    return isPermissionMode(values.permissionMode)
        ? values.permissionMode
        : "ask";
}

// Module-level cache survives component unmounts caused by route changes
let cachedMode: PermissionMode | null = null;

export function usePermissionMode({
    workspaceId,
    conversationId
}: PermissionModeScope) {
    const [mode, setMode] = useState<PermissionMode>(() => cachedMode ?? "ask");
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (!workspaceId) return;

        // When navigating to root (new agent), preserve the last known mode
        // instead of resetting to the workspace default.
        if (!conversationId && cachedMode !== null) return;

        const nextWorkspaceId = workspaceId;
        let cancelled = false;

        async function load() {
            setIsLoading(true);
            try {
                const values = conversationId
                    ? (
                          await fetchEffectiveConversationState(
                              nextWorkspaceId,
                              conversationId
                          )
                      ).merged
                    : (await fetchWorkspaceState(nextWorkspaceId)).values;

                if (!cancelled) {
                    const nextMode = toMode(values);
                    cachedMode = nextMode;
                    setMode(nextMode);
                }
            } finally {
                if (!cancelled) {
                    setIsLoading(false);
                }
            }
        }

        void load();

        return () => {
            cancelled = true;
        };
    }, [workspaceId, conversationId]);

    const setPermissionMode = useCallback(
        async (next: PermissionMode) => {
            cachedMode = next;
            setMode(next);

            if (!workspaceId) return;

            const payload = {
                values: { permissionMode: next },
                source: "permission-mode-selector"
            };

            if (conversationId) {
                await updateConversationState(
                    workspaceId,
                    conversationId,
                    payload
                );
                return;
            }

            await updateWorkspaceState(workspaceId, payload);
        },
        [workspaceId, conversationId]
    );

    return { mode, setPermissionMode, isLoading };
}
