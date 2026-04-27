import { z } from "zod";

export const reasoningEffortSchema = z.enum([
    "none",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh"
]);

export const modelStatusSchema = z.enum(["recommended", "alternative"]);
export const modelReleaseStageSchema = z.enum([
    "general",
    "research-preview",
    "legacy"
]);

export const modelAccessSchema = z.object({
    cli: z.boolean(),
    ide: z.boolean(),
    cloud: z.boolean().nullable(),
    api: z.boolean().nullable()
});

// All token prices are expressed in USD per 1,000,000 tokens (USD / MTok),
// which is the unit OpenAI's pricing pages use. We keep the unit explicit on
// the wire so consumers (e.g. cost estimators in the UI) don't have to guess.
export const tokenPricingSchema = z.object({
    input: z.number().nonnegative(),
    cachedInput: z.number().nonnegative().nullable(),
    output: z.number().nonnegative()
});

// GPT-5.5 / GPT-5.4 charge a multiplier on the *entire* session once the
// prompt exceeds a threshold (currently 272K input tokens). Encoding the rule
// instead of a flat number lets the UI show effective $/MTok for the current
// turn.
export const longContextPricingSchema = z.object({
    thresholdTokens: z.number().int().positive(),
    inputMultiplier: z.number().positive(),
    outputMultiplier: z.number().positive()
});

export const modelPricingSchema = z.object({
    currency: z.literal("USD"),
    unit: z.literal("per_1m_tokens"),
    standard: tokenPricingSchema.nullable(),
    priority: tokenPricingSchema.nullable(),
    batch: tokenPricingSchema.nullable(),
    longContext: longContextPricingSchema.nullable()
});

export const modelCatalogEntrySchema = z.object({
    id: z.string().min(1),
    apiModelId: z.string().min(1),
    provider: z.literal("openai"),
    displayName: z.string().min(1),
    tagline: z.string().min(1),
    description: z.string().min(1),
    status: modelStatusSchema,
    releaseStage: modelReleaseStageSchema,
    supportsReasoningEffort: z.boolean(),
    allowedEfforts: z.array(reasoningEffortSchema),
    defaultEffort: reasoningEffortSchema.nullable(),
    contextWindow: z.number().int().positive().nullable(),
    maxOutputTokens: z.number().int().positive().nullable(),
    knowledgeCutoff: z.string().nullable(),
    speedLabel: z.string().nullable(),
    reasoningLabel: z.string().nullable(),
    inputModalities: z.array(z.string()),
    outputModalities: z.array(z.string()),
    supportsImageInput: z.boolean(),
    supportsApi: z.boolean().nullable(),
    supportsChatCompletions: z.boolean().nullable(),
    supportsResponsesApi: z.boolean().nullable(),
    supportsRealtimeApi: z.boolean().nullable(),
    supportsBuiltInTools: z.boolean().nullable(),
    supportsComputerUse: z.boolean().nullable(),
    supportsWebSearch: z.boolean().nullable(),
    supportsFileSearch: z.boolean().nullable(),
    supportsMcp: z.boolean().nullable(),
    supportsApplyPatch: z.boolean().nullable(),
    supportsSkills: z.boolean().nullable(),
    supportsFastMode: z.boolean(),
    docsUrl: z.url(),
    codexDocsUrl: z.url(),
    access: modelAccessSchema,
    pricing: modelPricingSchema.nullable()
});

export type ReasoningEffort = z.infer<typeof reasoningEffortSchema>;
export type TokenPricing = z.infer<typeof tokenPricingSchema>;
export type LongContextPricing = z.infer<typeof longContextPricingSchema>;
export type ModelPricing = z.infer<typeof modelPricingSchema>;
export type ModelCatalogEntry = z.infer<typeof modelCatalogEntrySchema>;

export type ModelsErrorResponse = {
    error: string;
};
