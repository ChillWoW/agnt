import { useEffect, useId, useMemo, useRef } from "react";
import { getResolvedHotkeyCombo, useHotkeysStore } from "./hotkeys-store";
import type { HotkeyCombo, HotkeyId, UseHotkeyOptions } from "./types";

export function useHotkey({
    id,
    label,
    description,
    defaultCombo,
    handler,
    enabled = true,
    preventDefault = true
}: UseHotkeyOptions): HotkeyCombo | null {
    const tokenId = useId();
    const handlerRef = useRef(handler);
    handlerRef.current = handler;

    const token = useMemo(() => `hotkey-${tokenId}`, [tokenId]);

    useEffect(() => {
        useHotkeysStore.getState().upsertDefinition({
            id,
            label,
            description,
            defaultCombo
        });
    }, [defaultCombo, description, id, label]);

    useEffect(() => {
        useHotkeysStore.getState().registerHotkey({
            token,
            id,
            enabled,
            preventDefault,
            handler: (event) => handlerRef.current(event)
        });

        return () => useHotkeysStore.getState().unregisterHotkey(token);
    }, [enabled, id, preventDefault, token]);

    return useResolvedHotkeyCombo(id);
}

export function useResolvedHotkeyCombo(id: HotkeyId): HotkeyCombo | null {
    return useHotkeysStore((state) => getResolvedHotkeyCombo(state, id));
}
