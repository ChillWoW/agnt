import { z } from "zod";

/**
 * On-disk per-account record. Holds the OAuth token pair plus the JWT-derived
 * identity fields. Primary key is `accountId` (the JWT `chatgpt_account_id`
 * claim); we fall back to a synthetic UUID prefixed with `local-` for the
 * extremely rare case where the claim is missing (older / unknown providers).
 */
export const storedCodexAccountSchema = z.object({
    accountId: z.string().min(1),
    email: z.string().nullable().optional(),
    /**
     * Real display name pulled from the JWT id_token's `name` claim (or the
     * ChatGPT `/backend-api/me` endpoint). Optional because some accounts
     * don't set a profile name; the UI falls back to label → email → id.
     */
    name: z.string().nullable().optional(),
    label: z.string().nullable().optional(),
    access: z.string().min(1),
    refresh: z.string().min(1),
    expires: z.string().nullable(),
    connectedAt: z.string(),
    updatedAt: z.string()
});

/**
 * Whole `~/.agnt/auth.json` shape. `version: 2` is the multi-account era. The
 * service migrates legacy v1 (single blob) files into this shape on read.
 */
export const storedAuthFileSchema = z.object({
    version: z.literal(2),
    activeAccountId: z.string().nullable(),
    accounts: z.array(storedCodexAccountSchema)
});

/**
 * Legacy single-account on-disk shape. Used only by the migration path inside
 * the service; the rest of the codebase no longer touches it.
 */
export const legacyStoredCodexAuthSchema = z.object({
    access: z.string().min(1),
    refresh: z.string().min(1),
    expires: z.string().nullable(),
    accountId: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
    connectedAt: z.string(),
    updatedAt: z.string()
});

/**
 * Public, token-redacted shape returned over the wire and stored in the FE
 * store. Never includes `access` / `refresh`.
 */
export const authAccountSchema = z.object({
    accountId: z.string(),
    email: z.string().nullable(),
    name: z.string().nullable(),
    label: z.string().nullable(),
    expires: z.string().nullable(),
    connectedAt: z.string(),
    updatedAt: z.string()
});

export const authStateSchema = z.object({
    accounts: z.array(authAccountSchema),
    activeAccountId: z.string().nullable()
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
        status: z.literal("success"),
        accountId: z.string().nullable().optional()
    }),
    z.object({
        sessionId: z.string(),
        status: z.literal("error"),
        error: z.string()
    })
]);

export const authRenamePayloadSchema = z.object({
    label: z.string().min(1).max(40).nullable()
});

export type StoredCodexAccount = z.infer<typeof storedCodexAccountSchema>;
export type StoredAuthFile = z.infer<typeof storedAuthFileSchema>;
export type LegacyStoredCodexAuth = z.infer<typeof legacyStoredCodexAuthSchema>;
export type AuthAccount = z.infer<typeof authAccountSchema>;
export type AuthState = z.infer<typeof authStateSchema>;
export type AuthConnectStartResponse = z.infer<typeof authConnectStartResponseSchema>;
export type AuthOauthSessionStatus = z.infer<typeof authOauthSessionStatusSchema>;
export type AuthRenamePayload = z.infer<typeof authRenamePayloadSchema>;

export type AuthErrorResponse = {
    error: string;
};
