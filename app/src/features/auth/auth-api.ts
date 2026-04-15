import { api } from "@/lib/api";
import type {
    AuthConnectStartResponse,
    AuthOauthSessionStatus,
    AuthState
} from "./types";

export const authApi = {
    getState: () => api.get<AuthState>("/auth"),
    startOauth: () => api.post<AuthConnectStartResponse>("/auth/connect/oauth/start"),
    getOauthStatus: (sessionId: string) =>
        api.get<AuthOauthSessionStatus>("/auth/oauth/status", {
            query: { sessionId }
        }),
    disconnect: () => api.post<AuthState>("/auth/disconnect")
};
