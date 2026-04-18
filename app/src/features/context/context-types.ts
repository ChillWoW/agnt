export interface ContextBreakdown {
    messages: number;
    reasoning: number;
    toolOutputs: number;
    attachments: number;
    repoInstructions: number;
    systemInstructions: number;
}

export interface ContextSummary {
    modelId: string;
    modelDisplayName: string;
    contextWindow: number;
    maxOutputTokens: number | null;
    usedTokens: number;
    percent: number;
    breakdown: ContextBreakdown;
    messageCount: number;
    compactedMessageCount: number;
    hasCompactSummary: boolean;
    lastCompactedAt: string | null;
    autoCompactThreshold: number;
}

export interface CompactionResult {
    summaryMessageId: string | null;
    summarizedMessageIds: string[];
    keptMessageIds: string[];
    summarizedCount: number;
    usedTokensAfter: number;
    context: ContextSummary;
    skipped?: boolean;
    reason?: string;
}

export interface CompactedSseEvent {
    conversation_id: string;
    summaryMessageId: string;
    summarizedMessageIds: string[];
    summarizedCount: number;
    usedTokensAfter: number;
    summaryContent: string;
    summaryCreatedAt: string;
    summaryOfUntil: string;
}

export interface UsageSseEvent {
    inputTokens: number | null;
    outputTokens: number | null;
    reasoningTokens: number | null;
    totalTokens: number | null;
}
