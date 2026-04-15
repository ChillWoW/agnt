import { z } from "zod";

export const storedCodexAuthSchema = z.object({
    access: z.string().min(1),
    refresh: z.string().min(1),
    expires: z.string().nullable(),
    accountId: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
    connectedAt: z.string(),
    updatedAt: z.string()
});

export const authStateSchema = z.object({
    connected: z.boolean(),
    accountId: z.string().nullable(),
    email: z.string().nullable(),
    expires: z.string().nullable(),
    connectedAt: z.string().nullable(),
    updatedAt: z.string().nullable()
});

export const authConnectStartResponseSchema = z.object({
    sessionId: z.string(),
    authUrl: z.string()
});

export const authOauthSessionStatusSchema = z.union([
    z.object({
        sessionId: z.string(),
        status: z.literal("pending")
    }),
    z.object({
        sessionId: z.string(),
        status: z.literal("success")
    }),
    z.object({
        sessionId: z.string(),
        status: z.literal("error"),
        error: z.string()
    })
]);

export type StoredCodexAuth = z.infer<typeof storedCodexAuthSchema>;
export type AuthState = z.infer<typeof authStateSchema>;
export type AuthConnectStartResponse = z.infer<typeof authConnectStartResponseSchema>;
export type AuthOauthSessionStatus = z.infer<typeof authOauthSessionStatusSchema>;

export type AuthErrorResponse = {
    error: string;
};
