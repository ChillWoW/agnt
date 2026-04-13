import { useEffect, type ReactNode } from "react";
import { useSettingsStore } from "@/features/settings";
import { getResolvedHotkeyCombo, useHotkeysStore } from "./hotkeys-store";
import { isHotkeyEditableTarget, matchesHotkeyCombo } from "./hotkeys-utils";

const EMPTY_BINDINGS: Record<string, never> = {};

export function HotkeysProvider({ children }: { children: ReactNode }) {
    const bindings = useSettingsStore(
        (state) => state.settings?.hotkeys?.bindings
    );

    useEffect(() => {
        useHotkeysStore.getState().setBindings(bindings ?? EMPTY_BINDINGS);
    }, [bindings]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            const state = useHotkeysStore.getState();

            if (
                state.disabled ||
                event.defaultPrevented ||
                event.isComposing ||
                event.repeat ||
                isHotkeyEditableTarget(event.target)
            ) {
                return;
            }

            for (const registration of state.registrations) {
                if (!registration.enabled) continue;

                const combo = getResolvedHotkeyCombo(state, registration.id);
                if (!matchesHotkeyCombo(combo, event)) continue;

                if (registration.preventDefault) {
                    event.preventDefault();
                }

                registration.handler(event);
                break;
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, []);

    return children;
}
