import { api } from "@/lib/api";
import type {
    AuthConnectStartResponse,
    AuthOauthSessionStatus,
    AuthRateLimits,
    AuthState
} from "./types";

export const authApi = {
    getState: () => api.get<AuthState>("/auth"),
    startOauth: () => api.post<AuthConnectStartResponse>("/auth/connect/oauth/start"),
    getOauthStatus: (sessionId: string) =>
        api.get<AuthOauthSessionStatus>("/auth/oauth/status", {
            query: { sessionId }
        }),
    setActive: (accountId: string) =>
        api.post<AuthState>(
            `/auth/accounts/${encodeURIComponent(accountId)}/activate`
        ),
    removeAccount: (accountId: string) =>
        api.post<AuthState>(
            `/auth/accounts/${encodeURIComponent(accountId)}/disconnect`
        ),
    renameAccount: (accountId: string, label: string | null) =>
        api.patch<AuthState, { label: string | null }>(
            `/auth/accounts/${encodeURIComponent(accountId)}`,
            { body: { label } }
        ),
    disconnectAll: () => api.post<AuthState>("/auth/disconnect"),
    getRateLimits: (accountId?: string | null) =>
        api.get<AuthRateLimits>("/auth/rate-limits", {
            query: accountId ? { accountId } : undefined
        })
};
