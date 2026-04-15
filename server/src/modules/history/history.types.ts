import { z } from "zod";

export const historyScopeSchema = z.enum(["workspace", "conversation"]);

export const historyEntrySchema = z.object({
    id: z.string().uuid(),
    scopeType: historyScopeSchema,
    scopeId: z.string(),
    key: z.string(),
    value: z.unknown(),
    source: z.string().nullable(),
    createdAt: z.string()
});

export const scopeStateSchema = z.object({
    scopeType: historyScopeSchema,
    scopeId: z.string(),
    values: z.record(z.string(), z.unknown()),
    updatedAt: z.string().nullable()
});

export const effectiveConversationStateSchema = z.object({
    workspace: scopeStateSchema,
    conversation: scopeStateSchema,
    merged: z.record(z.string(), z.unknown())
});

export type HistoryScope = z.infer<typeof historyScopeSchema>;
export type HistoryEntry = z.infer<typeof historyEntrySchema>;
export type ScopeState = z.infer<typeof scopeStateSchema>;
export type EffectiveConversationState = z.infer<typeof effectiveConversationStateSchema>;
