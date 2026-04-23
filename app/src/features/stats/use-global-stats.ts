import { useEffect, useState, useCallback } from "react";
import { fetchGlobalStats } from "./stats-api";
import type { GlobalStats } from "./types";

interface UseGlobalStatsResult {
    stats: GlobalStats | null;
    loading: boolean;
    error: Error | null;
    refresh: () => void;
}

export function useGlobalStats(reloadKey?: string | null): UseGlobalStatsResult {
    const [stats, setStats] = useState<GlobalStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);
    const [tick, setTick] = useState(0);

    const refresh = useCallback(() => {
        setTick((t) => t + 1);
    }, []);

    useEffect(() => {
        let cancelled = false;

        setLoading(true);
        setError(null);

        fetchGlobalStats()
            .then((data) => {
                if (cancelled) return;
                setStats(data);
            })
            .catch((err) => {
                if (cancelled) return;
                setError(err instanceof Error ? err : new Error(String(err)));
            })
            .finally(() => {
                if (cancelled) return;
                setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [reloadKey, tick]);

    return { stats, loading, error, refresh };
}
