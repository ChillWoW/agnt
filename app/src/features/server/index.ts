import type { ServerConnectionState, ServerListener } from "@/typings/server";
import { useEffect, useState } from "react";

const SERVER_HEALTH_URL = "http://127.0.0.1:4727/health";

const listeners = new Set<ServerListener>();

let state: ServerConnectionState = {
    status: "connecting",
    lastOkAt: null,
    errorMessage: null
};

let intervalId: number | null = null;
let inFlightCheck: Promise<void> | null = null;

type Waiter = {
    resolve: () => void;
    reject: (error: Error) => void;
    timeoutId: number | null;
};

const waiters: Waiter[] = [];

function notify() {
    for (const listener of listeners) listener(state);
}

function setState(next: ServerConnectionState) {
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

async function probeHealth() {
    if (inFlightCheck) return inFlightCheck;

    inFlightCheck = (async () => {
        try {
            const response = await fetch(SERVER_HEALTH_URL, {
                method: "GET",
                cache: "no-store"
            });

            if (!response.ok) {
                throw new Error(`Health check failed (${response.status})`);
            }

            const data = await response.json();
            if (data.status !== "ok") {
                throw new Error(`Health check is not ok`);
            }

            setState({
                status: "connected",
                lastOkAt: Date.now(),
                errorMessage: null
            });
        } catch (error) {
            setState({
                status: "error",
                lastOkAt: null,
                errorMessage:
                    error instanceof Error
                        ? error.message
                        : "Unknown health error"
            });
        } finally {
            inFlightCheck = null;
        }
    })();

    return inFlightCheck;
}

export function ensureServerConnectionMonitorStarted() {
    if (intervalId !== null) return;

    setState({
        status: "connecting",
        lastOkAt: null,
        errorMessage: null
    });

    void probeHealth();

    intervalId = window.setInterval(() => {
        void probeHealth();
    }, 3000);
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

export function useServerConnection() {
    const [connection, setConnection] = useState<ServerConnectionState>(
        getServerConnectionState()
    );

    useEffect(() => {
        ensureServerConnectionMonitorStarted();
        return subscribeToServerConnection(setConnection);
    }, []);

    return connection;
}
