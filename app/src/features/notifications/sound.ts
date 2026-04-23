import finishUrl from "@/assets/sounds/finish.wav?url";
import permissionUrl from "@/assets/sounds/permission.wav?url";
import questionUrl from "@/assets/sounds/question.wav?url";

export type NotificationKind = "finish" | "permission" | "question";

const URL_BY_KIND: Record<NotificationKind, string> = {
    finish: finishUrl,
    permission: permissionUrl,
    question: questionUrl
};

// Default playback volume — tuned to feel present but not startling.
const DEFAULT_VOLUME = 0.25;

// Preload one primed <audio> element per kind so the first play has no delay.
const primed: Partial<Record<NotificationKind, HTMLAudioElement>> = {};

function prime(kind: NotificationKind): HTMLAudioElement {
    const existing = primed[kind];
    if (existing) return existing;
    const audio = new Audio(URL_BY_KIND[kind]);
    audio.preload = "auto";
    audio.volume = DEFAULT_VOLUME;
    primed[kind] = audio;
    return audio;
}

export function preloadSounds(): void {
    if (typeof Audio === "undefined") return;
    for (const kind of Object.keys(URL_BY_KIND) as NotificationKind[]) {
        prime(kind);
    }
}

export function playSound(
    kind: NotificationKind,
    volume = DEFAULT_VOLUME
): void {
    if (typeof Audio === "undefined") return;

    // Use a fresh Audio each play so rapid consecutive calls (e.g. two
    // permission requests back-to-back) don't cut each other off.
    const audio = new Audio(URL_BY_KIND[kind]);
    audio.volume = Math.max(0, Math.min(1, volume));
    const promise = audio.play();
    if (promise && typeof promise.catch === "function") {
        // Ignore autoplay-policy rejections so we never throw from a sound.
        promise.catch(() => undefined);
    }
    // Keep the primed element warm for future plays.
    prime(kind);
}
