import type { ServerConnectionState, ServerListener } from "@/typings/server";

export const SERVER_HEALTH_URL = "http://127.0.0.1:4727/health";

export const listeners = new Set<ServerListener>();

export let state: ServerConnectionState = {
    status: "connecting",
    lastOkAt: null,
    errorMessage: null
};

export let intervalId: number | null = null;
export let inFlightCheck: Promise<void> | null = null;

export type Waiter = {
    resolve: () => void;
    reject: (error: Error) => void;
    timeoutId: number | null;
};

export const waiters: Waiter[] = [];

export function notify() {
    for (const listener of listeners) listener(state);
}

export function setState(next: ServerConnectionState) {
    state = next;
    notify();

    if (state.status === "connected") {
        while (waiters.length > 0) {
            const waiter = waiters.shift();
            if (!waiter) continue;

            if (waiter.timeoutId !== null) clearTimeout(waiter.timeoutId);

            waiter.resolve();
        }
    }
}

export function setIntervalId(id: number | null) {
    intervalId = id;
}

export function setInFlightCheck(p: Promise<void> | null) {
    inFlightCheck = p;
}
