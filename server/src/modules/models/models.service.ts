import {
    modelCatalogEntrySchema,
    type ModelCatalogEntry
} from "./models.types";

const MODELS: ModelCatalogEntry[] = [
    {
        id: "gpt-5.4",
        apiModelId: "gpt-5.4",
        provider: "openai",
        displayName: "GPT-5.4",
        tagline: "Flagship frontier model for professional coding work.",
        description:
            "Best intelligence at scale for agentic, coding, and professional workflows.",
        status: "recommended",
        releaseStage: "general",
        supportsReasoningEffort: true,
        allowedEfforts: ["low", "medium", "high", "xhigh"],
        defaultEffort: "medium",
        contextWindow: 1050000,
        maxOutputTokens: 128000,
        knowledgeCutoff: "2025-08-31",
        speedLabel: "Medium",
        reasoningLabel: "Highest",
        inputModalities: ["text", "image"],
        outputModalities: ["text"],
        supportsImageInput: true,
        supportsApi: true,
        supportsChatCompletions: true,
        supportsResponsesApi: true,
        supportsRealtimeApi: true,
        supportsBuiltInTools: true,
        supportsComputerUse: true,
        supportsWebSearch: true,
        supportsFileSearch: true,
        supportsMcp: true,
        supportsApplyPatch: true,
        supportsSkills: true,
        supportsFastMode: true,
        docsUrl: "https://developers.openai.com/api/docs/models/gpt-5.4",
        codexDocsUrl: "https://developers.openai.com/codex/models",
        access: {
            cli: true,
            ide: true,
            cloud: true,
            api: true
        }
    },
    {
        id: "gpt-5.4-mini",
        apiModelId: "gpt-5.4-mini",
        provider: "openai",
        displayName: "GPT-5.4-Mini",
        tagline: "Fast, cost-efficient model for focused research tasks.",
        description:
            "Lightweight model optimized for sub-agent research, code reading, and analysis workflows.",
        status: "alternative",
        releaseStage: "general",
        supportsReasoningEffort: true,
        allowedEfforts: ["low", "medium", "high"],
        defaultEffort: "medium",
        contextWindow: 200000,
        maxOutputTokens: 65536,
        knowledgeCutoff: "2025-08-31",
        speedLabel: "Fast",
        reasoningLabel: "Medium",
        inputModalities: ["text", "image"],
        outputModalities: ["text"],
        supportsImageInput: true,
        supportsApi: true,
        supportsChatCompletions: true,
        supportsResponsesApi: true,
        supportsRealtimeApi: null,
        supportsBuiltInTools: null,
        supportsComputerUse: null,
        supportsWebSearch: null,
        supportsFileSearch: null,
        supportsMcp: null,
        supportsApplyPatch: null,
        supportsSkills: null,
        supportsFastMode: false,
        docsUrl: "https://developers.openai.com/api/docs/models/gpt-5.4-mini",
        codexDocsUrl: "https://developers.openai.com/codex/models",
        access: {
            cli: true,
            ide: true,
            cloud: true,
            api: true
        }
    },
    {
        id: "gpt-5.3-codex",
        apiModelId: "gpt-5.3-codex",
        provider: "openai",
        displayName: "GPT-5.3-Codex",
        tagline: "Most capable agentic coding model to date.",
        description:
            "Industry-leading coding model for complex software engineering and long-running coding workflows.",
        status: "recommended",
        releaseStage: "general",
        supportsReasoningEffort: true,
        allowedEfforts: ["low", "medium", "high", "xhigh"],
        defaultEffort: "medium",
        contextWindow: 400000,
        maxOutputTokens: 128000,
        knowledgeCutoff: "2025-08-31",
        speedLabel: "Medium",
        reasoningLabel: "Higher",
        inputModalities: ["text", "image"],
        outputModalities: ["text"],
        supportsImageInput: true,
        supportsApi: true,
        supportsChatCompletions: true,
        supportsResponsesApi: true,
        supportsRealtimeApi: true,
        supportsBuiltInTools: null,
        supportsComputerUse: null,
        supportsWebSearch: null,
        supportsFileSearch: null,
        supportsMcp: null,
        supportsApplyPatch: null,
        supportsSkills: null,
        supportsFastMode: false,
        docsUrl: "https://developers.openai.com/api/docs/models/gpt-5.3-codex",
        codexDocsUrl: "https://developers.openai.com/codex/models",
        access: {
            cli: true,
            ide: true,
            cloud: true,
            api: true
        }
    }
].map((model) => modelCatalogEntrySchema.parse(model));

export function getModels(): ModelCatalogEntry[] {
    return MODELS;
}

export function getModelById(modelId: string): ModelCatalogEntry | null {
    return MODELS.find((model) => model.id === modelId) ?? null;
}
