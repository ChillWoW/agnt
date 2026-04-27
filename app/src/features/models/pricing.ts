import type { ModelCatalogEntry, TokenPricing } from "./types";

/**
 * Per-turn token usage as reported by the server (Vercel AI SDK / OpenAI
 * Responses API). For OpenAI's Responses API, `outputTokens` already includes
 * reasoning tokens (they're a billable subset of completion tokens), so we
 * never add `reasoningTokens` on top of it when computing cost.
 *
 * `cachedInputTokens` is reserved for when the server starts surfacing the
 * cached-tokens breakdown — at that point cached tokens are billed at
 * `pricing.standard.cachedInput` instead of the regular input rate. It's
 * optional today and falls back to 0.
 */
export type TurnUsage = {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens?: number;
};

export type CostBreakdown = {
    inputUsd: number;
    cachedInputUsd: number;
    outputUsd: number;
    totalUsd: number;
    /** Effective $/MTok used for input after applying any multiplier. */
    effectiveInputRate: number;
    /** Effective $/MTok used for output after applying any multiplier. */
    effectiveOutputRate: number;
    /** True when the long-context multiplier was applied to this turn. */
    longContextApplied: boolean;
};

/**
 * Apply the long-context multiplier (e.g. GPT-5.5 / GPT-5.4 charge 2x input
 * and 1.5x output once the prompt exceeds 272K tokens) to a base price tier.
 */
function applyLongContextMultiplier(
    base: TokenPricing,
    model: ModelCatalogEntry,
    inputTokens: number
): { tier: TokenPricing; applied: boolean } {
    const lc = model.pricing?.longContext;
    if (!lc || inputTokens <= lc.thresholdTokens) {
        return { tier: base, applied: false };
    }
    return {
        tier: {
            input: base.input * lc.inputMultiplier,
            cachedInput:
                base.cachedInput == null
                    ? null
                    : base.cachedInput * lc.inputMultiplier,
            output: base.output * lc.outputMultiplier
        },
        applied: true
    };
}

/**
 * Estimate the OpenAI API cost (USD) for a single assistant turn, based on
 * the model's published `pricing.standard` rates. Returns `null` when the
 * model has no published pricing (e.g. the unknown-model fallback).
 *
 * NOTE: this is an *approximation* — it always uses the standard tier and
 * ignores cache hit-rate variability. Surface it to the user with a "~"
 * prefix.
 */
export function estimateTurnCostUsd(
    model: ModelCatalogEntry | null | undefined,
    usage: TurnUsage
): CostBreakdown | null {
    const standard = model?.pricing?.standard;
    if (!standard) return null;

    const cached = Math.max(0, usage.cachedInputTokens ?? 0);
    const billableInput = Math.max(0, usage.inputTokens - cached);
    const output = Math.max(0, usage.outputTokens);

    const { tier, applied } = applyLongContextMultiplier(
        standard,
        model!,
        usage.inputTokens
    );

    const inputUsd = (billableInput * tier.input) / 1_000_000;
    const cachedRate = tier.cachedInput ?? tier.input;
    const cachedInputUsd = (cached * cachedRate) / 1_000_000;
    const outputUsd = (output * tier.output) / 1_000_000;

    return {
        inputUsd,
        cachedInputUsd,
        outputUsd,
        totalUsd: inputUsd + cachedInputUsd + outputUsd,
        effectiveInputRate: tier.input,
        effectiveOutputRate: tier.output,
        longContextApplied: applied
    };
}

/**
 * Human-friendly USD formatter that keeps tiny amounts readable. Examples:
 *   0          → "$0"
 *   0.0004     → "<$0.01"
 *   0.0123     → "$0.012"
 *   0.1234     → "$0.12"
 *   1.234      → "$1.23"
 *   1234.5     → "$1,234.50"
 */
export function formatCostUsd(amount: number): string {
    if (!Number.isFinite(amount) || amount <= 0) return "$0";
    if (amount < 0.01) return "<$0.01";
    if (amount < 0.1) {
        return (
            "$" +
            amount.toLocaleString("en-US", {
                minimumFractionDigits: 3,
                maximumFractionDigits: 3
            })
        );
    }
    return (
        "$" +
        amount.toLocaleString("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        })
    );
}

/** Compact integer formatter for token counts (e.g. 5234 → "5,234"). */
export function formatTokenCount(n: number | null | undefined): string {
    if (typeof n !== "number" || !Number.isFinite(n)) return "—";
    return Math.max(0, Math.round(n)).toLocaleString("en-US");
}
