import type { ServerListener } from "@/typings/server";
import {
    state,
    intervalId,
    listeners,
    waiters,
    setState,
    setIntervalId,
    type Waiter
} from "./state";
import { probeHealth } from "./health";

export function ensureServerConnectionMonitorStarted() {
    if (intervalId !== null) return;

    setState({
        status: "connecting",
        lastOkAt: null,
        errorMessage: null
    });

    void probeHealth();

    setIntervalId(
        window.setInterval(() => {
            void probeHealth();
        }, 3000)
    );
}

export function getServerConnectionState() {
    return state;
}

export function subscribeToServerConnection(listener: ServerListener) {
    listeners.add(listener);
    listener(state);

    return () => {
        listeners.delete(listener);
    };
}

// This is a universal gate, any api call can await this before a fetch call
export async function waitForServerConnection(options?: { timeout?: number }) {
    ensureServerConnectionMonitorStarted();

    if (state.status === "connected") return Promise.resolve();

    const timeout = options?.timeout;

    return new Promise<void>((resolve, reject) => {
        const waiter: Waiter = { resolve, reject, timeoutId: null };

        if (typeof timeout === "number" && timeout > 0) {
            waiter.timeoutId = window.setTimeout(() => {
                const index = waiters.indexOf(waiter);
                if (index >= 0) waiters.splice(index, 1);
                reject(
                    new Error(
                        `Timed out waiting for server connection after ${timeout}ms`
                    )
                );
            }, timeout);
        }

        waiters.push(waiter);
    });
}
