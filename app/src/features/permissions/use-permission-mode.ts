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

export function usePermissionMode({
    workspaceId,
    conversationId
}: PermissionModeScope) {
    const [mode, setMode] = useState<PermissionMode>("ask");
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (!workspaceId) return;

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
                    setMode(toMode(values));
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
