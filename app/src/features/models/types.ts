export type ReasoningEffort =
    | "none"
    | "minimal"
    | "low"
    | "medium"
    | "high"
    | "xhigh";

export type ModelStatus = "recommended" | "alternative";
export type ModelReleaseStage = "general" | "research-preview" | "legacy";
export type ModelSpeed = "standard" | "fast";

// All token prices are USD per 1,000,000 tokens (USD / MTok), matching the
// `pricing.unit` field returned by the server.
export type TokenPricing = {
    input: number;
    cachedInput: number | null;
    output: number;
};

// Long-context multipliers (e.g. GPT-5.5 / GPT-5.4 charge 2x input / 1.5x
// output for prompts above 272K tokens). Null when the model has no
// long-context tier.
export type LongContextPricing = {
    thresholdTokens: number;
    inputMultiplier: number;
    outputMultiplier: number;
};

export type ModelPricing = {
    currency: "USD";
    unit: "per_1m_tokens";
    standard: TokenPricing | null;
    priority: TokenPricing | null;
    batch: TokenPricing | null;
    longContext: LongContextPricing | null;
};

export type ModelAccess = {
    cli: boolean;
    ide: boolean;
    cloud: boolean | null;
    api: boolean | null;
};

export type ModelCatalogEntry = {
    id: string;
    apiModelId: string;
    provider: "openai";
    displayName: string;
    tagline: string;
    description: string;
    status: ModelStatus;
    releaseStage: ModelReleaseStage;
    supportsReasoningEffort: boolean;
    allowedEfforts: ReasoningEffort[];
    defaultEffort: ReasoningEffort | null;
    contextWindow: number | null;
    maxOutputTokens: number | null;
    knowledgeCutoff: string | null;
    speedLabel: string | null;
    reasoningLabel: string | null;
    inputModalities: string[];
    outputModalities: string[];
    supportsImageInput: boolean;
    supportsApi: boolean | null;
    supportsChatCompletions: boolean | null;
    supportsResponsesApi: boolean | null;
    supportsRealtimeApi: boolean | null;
    supportsBuiltInTools: boolean | null;
    supportsComputerUse: boolean | null;
    supportsWebSearch: boolean | null;
    supportsFileSearch: boolean | null;
    supportsMcp: boolean | null;
    supportsApplyPatch: boolean | null;
    supportsSkills: boolean | null;
    supportsFastMode: boolean;
    docsUrl: string;
    codexDocsUrl: string;
    access: ModelAccess;
    pricing: ModelPricing | null;
};

export type ModelSelection = {
    modelId: string | null;
    reasoningEffort: ReasoningEffort | null;
    speed: ModelSpeed;
};
