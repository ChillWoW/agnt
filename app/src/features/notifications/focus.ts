import { getCurrentWindow } from "@tauri-apps/api/window";
import { useSyncExternalStore } from "react";

let focused = true;
let initialized = false;
const listeners = new Set<() => void>();

function emit(): void {
    for (const l of listeners) l();
}

export function isWindowFocused(): boolean {
    return focused;
}

export async function initWindowFocusTracking(): Promise<void> {
    if (initialized) return;
    initialized = true;

    try {
        const win = getCurrentWindow();
        try {
            focused = await win.isFocused();
        } catch {
            // isFocused can throw in non-Tauri dev contexts; default true.
            focused = true;
        }
        await win.onFocusChanged(({ payload }) => {
            focused = Boolean(payload);
            emit();
        });
    } catch {
        // Not running inside Tauri (e.g. plain browser dev). Fall back to the
        // Page Visibility + focus/blur DOM events so the module still works.
        const update = () => {
            const visible = !document.hidden;
            const docFocused =
                typeof document.hasFocus === "function"
                    ? document.hasFocus()
                    : true;
            const next = visible && docFocused;
            if (next !== focused) {
                focused = next;
                emit();
            }
        };
        document.addEventListener("visibilitychange", update);
        window.addEventListener("focus", update);
        window.addEventListener("blur", update);
        update();
    }

    emit();
}

export function subscribeWindowFocus(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function useIsWindowFocused(): boolean {
    return useSyncExternalStore(
        subscribeWindowFocus,
        isWindowFocused,
        isWindowFocused
    );
}
