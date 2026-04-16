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

export type TokenPricing = {
    input: number;
    cachedInput: number | null;
    output: number;
};

export type ModelPricing = {
    standard: TokenPricing | null;
    priority: TokenPricing | null;
};

export type ModelCatalogEntry = {
    id: string;
    apiModelId: string;
    provider: "openai";
    providerLabel: string;
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
    supportsPdfInput: boolean;
    supportsFastMode: boolean;
    docsUrl: string;
    codexDocsUrl: string;
    pricing: ModelPricing;
};

export type ModelSelection = {
    modelId: string | null;
    reasoningEffort: ReasoningEffort | null;
    speed: ModelSpeed;
};
