import { create } from "zustand";
import { toApiErrorMessage } from "@/lib/api";
import { authApi } from "./auth-api";
import { openExternalUrl } from "./open-external-url";
import type { AuthOauthSessionStatus, AuthState } from "./types";

type AuthStore = {
    auth: AuthState | null;
    isLoading: boolean;
    isConnecting: boolean;
    isDisconnecting: boolean;
    hasLoaded: boolean;
    error: string | null;
    serverUrl: string | null;
    ensureLoaded: (serverUrl: string) => Promise<void>;
    refresh: () => Promise<void>;
    connect: () => Promise<boolean>;
    disconnect: () => Promise<boolean>;
};

let loadRequestId = 0;
let loadPromise: Promise<void> | null = null;
let loadPromiseServerUrl: string | null = null;

function delay(ms: number) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function waitForOauthCompletion(sessionId: string): Promise<AuthOauthSessionStatus> {
    const startedAt = Date.now();

    while (Date.now() - startedAt < 3 * 60 * 1000) {
        const status = await authApi.getOauthStatus(sessionId);

        if (status.status !== "pending") {
            return status;
        }

        await delay(1500);
    }

    const timeoutStatus: AuthOauthSessionStatus = {
        sessionId,
        status: "error",
        error: "Timed out waiting for the Codex browser login to finish"
    };

    return timeoutStatus;
}

export const useAuthStore = create<AuthStore>((set, get) => ({
    auth: null,
    isLoading: false,
    isConnecting: false,
    isDisconnecting: false,
    hasLoaded: false,
    error: null,
    serverUrl: null,

    ensureLoaded: async (serverUrl) => {
        const state = get();

        if (state.serverUrl === serverUrl && state.hasLoaded) {
            return;
        }

        if (loadPromise && loadPromiseServerUrl === serverUrl) {
            return loadPromise;
        }

        loadRequestId += 1;
        const requestId = loadRequestId;

        set({
            auth: state.serverUrl === serverUrl ? state.auth : null,
            isLoading: true,
            hasLoaded: state.serverUrl === serverUrl ? state.hasLoaded : false,
            error: null,
            serverUrl: state.serverUrl === serverUrl ? state.serverUrl : null
        });

        const nextPromise = (async () => {
            try {
                const auth = await authApi.getState();

                if (requestId !== loadRequestId) {
                    return;
                }

                set({
                    auth,
                    isLoading: false,
                    hasLoaded: true,
                    error: null,
                    serverUrl
                });
            } catch (error) {
                if (requestId !== loadRequestId) {
                    return;
                }

                set({
                    isLoading: false,
                    error: toApiErrorMessage(error, "Unable to load Codex authentication")
                });
            }
        })();

        loadPromise = nextPromise;
        loadPromiseServerUrl = serverUrl;

        try {
            await nextPromise;
        } finally {
            if (loadPromise === nextPromise) {
                loadPromise = null;
                loadPromiseServerUrl = null;
            }
        }
    },

    refresh: async () => {
        try {
            const auth = await authApi.getState();

            set({
                auth,
                hasLoaded: true,
                error: null
            });
        } catch (error) {
            set({
                error: toApiErrorMessage(error, "Unable to load Codex authentication")
            });
        }
    },

    connect: async () => {
        set({ isConnecting: true, error: null });

        try {
            const { authUrl, sessionId } = await authApi.startOauth();
            await openExternalUrl(authUrl);

            const status = await waitForOauthCompletion(sessionId);

            if (status.status === "error") {
                set({ isConnecting: false, error: status.error });
                return false;
            }

            const auth = await authApi.getState();

            set({
                auth,
                hasLoaded: true,
                isConnecting: false,
                error: null
            });

            return true;
        } catch (error) {
            set({
                isConnecting: false,
                error: toApiErrorMessage(error, "Unable to connect Codex")
            });
            return false;
        }
    },

    disconnect: async () => {
        set({ isDisconnecting: true, error: null });

        try {
            const auth = await authApi.disconnect();

            set({
                auth,
                hasLoaded: true,
                isDisconnecting: false,
                error: null
            });

            return true;
        } catch (error) {
            set({
                isDisconnecting: false,
                error: toApiErrorMessage(error, "Unable to disconnect Codex")
            });
            return false;
        }
    }
}));
