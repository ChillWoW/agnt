import { useCallback, useEffect } from "react";
import { create } from "zustand";
import {
    fetchEffectiveConversationState,
    fetchWorkspaceState,
    updateConversationState,
    updateWorkspaceState
} from "@/features/history";
import type { AgenticMode } from "./plan-types";

interface AgenticModeScope {
    workspaceId?: string | null;
    conversationId?: string | null;
}

function isAgenticMode(value: unknown): value is AgenticMode {
    return value === "agent" || value === "plan";
}

function toMode(values: Record<string, unknown>): AgenticMode {
    return isAgenticMode(values.agenticMode) ? values.agenticMode : "agent";
}

interface AgenticModeStore {
    mode: AgenticMode;
    setMode: (mode: AgenticMode) => void;
}

const useAgenticModeStore = create<AgenticModeStore>()((set) => ({
    mode: "agent",
    setMode: (mode) => set({ mode })
}));

export function useAgenticMode({
    workspaceId,
    conversationId
}: AgenticModeScope) {
    const mode = useAgenticModeStore((s) => s.mode);
    const storeSetMode = useAgenticModeStore((s) => s.setMode);

    useEffect(() => {
        if (!workspaceId) return;

        const nextWorkspaceId = workspaceId;
        let cancelled = false;

        async function load() {
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
                    storeSetMode(toMode(values));
                }
            } catch {
                // keep current mode on error
            }
        }

        void load();

        return () => {
            cancelled = true;
        };
    }, [workspaceId, conversationId, storeSetMode]);

    const setAgenticMode = useCallback(
        async (next: AgenticMode) => {
            storeSetMode(next);

            if (!workspaceId) return;

            const payload = {
                values: { agenticMode: next },
                source: "agentic-mode-selector"
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
        [workspaceId, conversationId, storeSetMode]
    );

    return { mode, setAgenticMode };
}
