import {
    modelCatalogEntrySchema,
    type ModelCatalogEntry
} from "./models.types";

// All prices are USD per 1,000,000 tokens (USD / MTok), matching OpenAI's
// public pricing pages. Sources:
//   - https://developers.openai.com/api/docs/models/gpt-5.5
//   - https://developers.openai.com/api/docs/models/gpt-5.4
//   - https://developers.openai.com/api/docs/models/gpt-5.4-mini
//   - https://developers.openai.com/api/docs/models/gpt-5.3-codex
//   - https://developers.openai.com/codex/models
const MODELS: ModelCatalogEntry[] = [
    {
        id: "gpt-5.5",
        apiModelId: "gpt-5.5",
        provider: "openai",
        displayName: "GPT-5.5",
        tagline: "OpenAI's newest frontier model for complex tasks.",
        description:
            "Most capable frontier model for complex coding, computer use, knowledge work, and research workflows. Available in Codex with ChatGPT sign-in; not yet available with API-key authentication in Codex.",
        status: "recommended",
        releaseStage: "general",
        supportsReasoningEffort: true,
        // Per docs: reasoning.effort supports none, low, medium (default), high, xhigh.
        // We keep "none" out of the picker because this app is reasoning-first.
        allowedEfforts: ["low", "medium", "high", "xhigh"],
        defaultEffort: "medium",
        contextWindow: 1050000,
        maxOutputTokens: 128000,
        knowledgeCutoff: "2025-12-01",
        speedLabel: "Fast",
        reasoningLabel: "Highest",
        inputModalities: ["text", "image"],
        outputModalities: ["text"],
        supportsImageInput: true,
        // The OpenAI API itself supports gpt-5.5 (Chat Completions, Responses,
        // Realtime, Batch, etc.). The Codex-specific restriction is captured
        // by `access.api` below.
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
        docsUrl: "https://developers.openai.com/api/docs/models/gpt-5.5",
        codexDocsUrl: "https://developers.openai.com/codex/models",
        access: {
            cli: true,
            ide: true,
            cloud: true,
            // Codex requires ChatGPT sign-in for gpt-5.5 today; API-key auth
            // is not yet supported.
            api: false
        },
        pricing: {
            currency: "USD",
            unit: "per_1m_tokens",
            standard: {
                input: 5.0,
                cachedInput: 0.5,
                output: 30.0
            },
            priority: null,
            batch: {
                input: 5.0,
                cachedInput: 0.5,
                output: 30.0
            },
            // Prompts >272K input tokens are priced at 2x input / 1.5x output
            // for the full session (standard, batch, and flex).
            longContext: {
                thresholdTokens: 272000,
                inputMultiplier: 2,
                outputMultiplier: 1.5
            }
        }
    },
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
        },
        pricing: {
            currency: "USD",
            unit: "per_1m_tokens",
            standard: {
                input: 2.5,
                cachedInput: 0.25,
                output: 15.0
            },
            priority: null,
            batch: {
                input: 2.5,
                cachedInput: 0.25,
                output: 15.0
            },
            longContext: {
                thresholdTokens: 272000,
                inputMultiplier: 2,
                outputMultiplier: 1.5
            }
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
        // Per docs: 400K context window, 128K max output (the previous
        // 200K / 65K values were stale).
        contextWindow: 400000,
        maxOutputTokens: 128000,
        knowledgeCutoff: "2025-08-31",
        speedLabel: "Fast",
        reasoningLabel: "Higher",
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
        supportsFastMode: false,
        docsUrl: "https://developers.openai.com/api/docs/models/gpt-5.4-mini",
        codexDocsUrl: "https://developers.openai.com/codex/models",
        access: {
            cli: true,
            ide: true,
            cloud: true,
            api: true
        },
        pricing: {
            currency: "USD",
            unit: "per_1m_tokens",
            standard: {
                input: 0.75,
                cachedInput: 0.075,
                output: 4.5
            },
            priority: null,
            batch: {
                input: 0.75,
                cachedInput: 0.075,
                output: 4.5
            },
            longContext: null
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
        // gpt-5.3-codex docs only list streaming/function-calling/structured-
        // outputs explicitly; tool support beyond that isn't documented, so
        // we leave it null instead of guessing.
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
        },
        pricing: {
            currency: "USD",
            unit: "per_1m_tokens",
            standard: {
                input: 1.75,
                cachedInput: 0.175,
                output: 14.0
            },
            priority: null,
            batch: null,
            longContext: null
        }
    }
].map((model) => modelCatalogEntrySchema.parse(model));

export function getModels(): ModelCatalogEntry[] {
    return MODELS;
}

export function getModelById(modelId: string): ModelCatalogEntry | null {
    return MODELS.find((model) => model.id === modelId) ?? null;
}

/**
 * The catalog-derived default model id. Mirrors the UI's
 * `getDefaultSelection` (`app/src/features/models/use-model-selection.ts`)
 * which picks the first entry with `status: "recommended"`. Keeping this
 * derivation centralized prevents a class of "UI shows model X but server
 * silently falls back to model Y" bugs whenever the catalog gains a new
 * recommended model — both sides update from the same source of truth.
 */
export function getDefaultModelId(): string {
    const recommended = MODELS.find((model) => model.status === "recommended");
    const fallback = recommended ?? MODELS[0] ?? null;
    return fallback?.id ?? "gpt-5.5";
}
