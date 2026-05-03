import { create } from "zustand";
import { toApiErrorMessage } from "@/lib/api";
import { authApi } from "./auth-api";
import { openExternalUrl } from "./open-external-url";
import type { AuthAccount, AuthOauthSessionStatus, AuthState } from "./types";

type AuthStore = {
    accounts: AuthAccount[];
    activeAccountId: string | null;
    isLoading: boolean;
    isConnecting: boolean;
    isDisconnecting: boolean;
    hasLoaded: boolean;
    error: string | null;
    serverUrl: string | null;
    ensureLoaded: (serverUrl: string) => Promise<void>;
    refresh: () => Promise<void>;
    addAccount: () => Promise<{
        ok: boolean;
        accountId?: string | null;
        error?: string;
    }>;
    setActive: (accountId: string) => Promise<boolean>;
    removeAccount: (accountId: string) => Promise<boolean>;
    renameAccount: (accountId: string, label: string | null) => Promise<boolean>;
    disconnectAll: () => Promise<boolean>;
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

    return {
        sessionId,
        status: "error",
        error: "Timed out waiting for the Codex browser login to finish"
    };
}

function applyAuthState(state: AuthState) {
    return {
        accounts: state.accounts,
        activeAccountId: state.activeAccountId,
        hasLoaded: true,
        error: null
    };
}

export const useAuthStore = create<AuthStore>((set, get) => ({
    accounts: [],
    activeAccountId: null,
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
            accounts: state.serverUrl === serverUrl ? state.accounts : [],
            activeAccountId:
                state.serverUrl === serverUrl ? state.activeAccountId : null,
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
                    ...applyAuthState(auth),
                    isLoading: false,
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
            set(applyAuthState(auth));
        } catch (error) {
            set({
                error: toApiErrorMessage(error, "Unable to load Codex authentication")
            });
        }
    },

    addAccount: async () => {
        set({ isConnecting: true, error: null });

        try {
            const { authUrl, sessionId } = await authApi.startOauth();
            await openExternalUrl(authUrl);

            const status = await waitForOauthCompletion(sessionId);

            if (status.status === "error") {
                set({ isConnecting: false, error: status.error });
                return { ok: false, error: status.error };
            }

            const auth = await authApi.getState();
            set({
                ...applyAuthState(auth),
                isConnecting: false
            });

            const newAccountId =
                status.status === "success" ? status.accountId ?? null : null;
            return { ok: true, accountId: newAccountId };
        } catch (error) {
            const message = toApiErrorMessage(error, "Unable to connect Codex");
            set({
                isConnecting: false,
                error: message
            });
            return { ok: false, error: message };
        }
    },

    setActive: async (accountId) => {
        try {
            const auth = await authApi.setActive(accountId);
            set(applyAuthState(auth));
            return true;
        } catch (error) {
            set({
                error: toApiErrorMessage(error, "Unable to switch active account")
            });
            return false;
        }
    },

    removeAccount: async (accountId) => {
        set({ isDisconnecting: true, error: null });

        try {
            const auth = await authApi.removeAccount(accountId);
            set({
                ...applyAuthState(auth),
                isDisconnecting: false
            });
            return true;
        } catch (error) {
            set({
                isDisconnecting: false,
                error: toApiErrorMessage(error, "Unable to disconnect account")
            });
            return false;
        }
    },

    renameAccount: async (accountId, label) => {
        try {
            const auth = await authApi.renameAccount(accountId, label);
            set(applyAuthState(auth));
            return true;
        } catch (error) {
            set({
                error: toApiErrorMessage(error, "Unable to rename account")
            });
            return false;
        }
    },

    disconnectAll: async () => {
        set({ isDisconnecting: true, error: null });

        try {
            const auth = await authApi.disconnectAll();
            set({
                ...applyAuthState(auth),
                isDisconnecting: false
            });
            return true;
        } catch (error) {
            set({
                isDisconnecting: false,
                error: toApiErrorMessage(error, "Unable to disconnect")
            });
            return false;
        }
    }
}));

/**
 * Selectors. Exported so call sites can use shallow comparison and avoid
 * re-renders on unrelated state changes.
 */
export function selectActiveAccount(
    state: Pick<AuthStore, "accounts" | "activeAccountId">
): AuthAccount | null {
    if (!state.activeAccountId) return null;
    return (
        state.accounts.find(
            (account) => account.accountId === state.activeAccountId
        ) ?? null
    );
}

export function selectIsConnected(
    state: Pick<AuthStore, "accounts" | "activeAccountId">
): boolean {
    return selectActiveAccount(state) !== null;
}
