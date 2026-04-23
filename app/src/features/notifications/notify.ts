import {
    isPermissionGranted,
    requestPermission,
    sendNotification
} from "@tauri-apps/plugin-notification";
import { useSettingsStore } from "@/features/settings";
import { isWindowFocused } from "./focus";
import { playSound, type NotificationKind } from "./sound";

export type NotifyArgs = {
    kind: NotificationKind;
    title: string;
    body?: string;
    /** If provided, stored on the notification so clicks can route to it later. */
    conversationId?: string;
};

let permissionState: "unknown" | "granted" | "denied" | "requesting" = "unknown";

async function ensurePermission(): Promise<boolean> {
    if (permissionState === "granted") return true;
    if (permissionState === "denied") return false;
    if (permissionState === "requesting") return false;

    permissionState = "requesting";
    try {
        let granted = await isPermissionGranted();
        if (!granted) {
            const requested = await requestPermission();
            granted = requested === "granted";
        }
        permissionState = granted ? "granted" : "denied";
        return granted;
    } catch {
        // Not inside Tauri, or plugin missing — treat as denied silently.
        permissionState = "denied";
        return false;
    }
}

export function notify(args: NotifyArgs): void {
    const settings = useSettingsStore.getState().settings.notifications;

    if (!settings?.enabled) return;

    if (settings.soundEnabled) {
        playSound(args.kind);
    }

    if (!settings.osNotificationsEnabled) return;

    // Only surface an OS notification when the user isn't looking at the app.
    if (isWindowFocused()) return;

    void (async () => {
        const granted = await ensurePermission();
        if (!granted) return;
        try {
            sendNotification({
                title: args.title,
                ...(args.body ? { body: args.body } : {})
            });
        } catch {
            // Silently ignore notification failures (headless env, etc.).
        }
    })();
}
