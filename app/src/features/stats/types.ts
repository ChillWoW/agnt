export interface GlobalStats {
    totals: {
        sessions: number;
        userMessages: number;
        inputTokens: number;
        outputTokens: number;
        reasoningTokens: number;
        totalTokens: number;
        activeDays: number;
    };
    streak: {
        current: number;
        longest: number;
    };
    favoriteModel: {
        id: string;
        label: string;
        count: number;
    } | null;
    models: { id: string; label: string; count: number }[];
    hours: number[];
    mostActiveHour: number | null;
    heatmap: {
        startDate: string;
        endDate: string;
        days: { date: string; count: number }[];
    };
    workspaceCount: number;
}
