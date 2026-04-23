import { api } from "@/lib/api";
import type { GlobalStats } from "./types";

export function fetchGlobalStats(): Promise<GlobalStats> {
    const tzOffsetMinutes = -new Date().getTimezoneOffset();
    return api.get<GlobalStats>("/stats", {
        query: { tzOffsetMinutes }
    });
}
