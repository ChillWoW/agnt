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
    access: modelAccessSchema
});

export type ReasoningEffort = z.infer<typeof reasoningEffortSchema>;
export type ModelCatalogEntry = z.infer<typeof modelCatalogEntrySchema>;

export type ModelsErrorResponse = {
    error: string;
};
