import { getWorkspaceDb } from "../../lib/db";
import { listWorkspaces } from "../workspaces/workspaces.service";
import { getModelById } from "../models/models.service";

// Heatmap window. Rendered as 30 columns × 7 rows to match the reference
// compact card layout (~210 cells spanning ~7 months).
const HEATMAP_DAYS = 210;

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

interface HourRow {
    h: number;
    c: number;
}

interface DayRow {
    d: string;
    c: number;
}

interface ModelRow {
    model_id: string;
    c: number;
}

interface TotalRow {
    user_messages: number | null;
    input_tokens: number | null;
    output_tokens: number | null;
    reasoning_tokens: number | null;
    total_tokens: number | null;
}

interface CountRow {
    c: number | null;
}

interface DistinctDayRow {
    d: string;
}

/**
 * Build the SQLite datetime modifier string that shifts a UTC timestamp into
 * the client's local day. `tzOffsetMinutes` is the offset in minutes east of
 * UTC (matches `-new Date().getTimezoneOffset()`); for UTC-7 (PDT) it is -420.
 */
function tzModifier(tzOffsetMinutes: number): string {
    const sign = tzOffsetMinutes >= 0 ? "+" : "-";
    return `${sign}${Math.abs(tzOffsetMinutes)} minutes`;
}

function todayInClientTz(tzOffsetMinutes: number): string {
    const nowMs = Date.now();
    const localMs = nowMs + tzOffsetMinutes * 60_000;
    return new Date(localMs).toISOString().slice(0, 10);
}

function addDays(date: string, delta: number): string {
    const parts = date.split("-").map(Number);
    const y = parts[0] ?? 1970;
    const m = parts[1] ?? 1;
    const d = parts[2] ?? 1;
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + delta);
    return dt.toISOString().slice(0, 10);
}

function computeStreaks(
    daysSet: Set<string>,
    today: string
): { current: number; longest: number } {
    if (daysSet.size === 0) return { current: 0, longest: 0 };

    const sorted = Array.from(daysSet).sort();
    let longest = 1;
    let run = 1;
    for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const cur = sorted[i];
        if (prev && cur && addDays(prev, 1) === cur) {
            run += 1;
            if (run > longest) longest = run;
        } else {
            run = 1;
        }
    }

    let current = 0;
    const yesterday = addDays(today, -1);
    let anchor: string | null = null;
    if (daysSet.has(today)) anchor = today;
    else if (daysSet.has(yesterday)) anchor = yesterday;

    if (anchor) {
        let cursor = anchor;
        while (daysSet.has(cursor)) {
            current += 1;
            cursor = addDays(cursor, -1);
        }
    }

    return { current, longest };
}

export function getGlobalStats(tzOffsetMinutes: number): GlobalStats {
    const modifier = tzModifier(tzOffsetMinutes);
    const today = todayInClientTz(tzOffsetMinutes);
    const heatmapStart = addDays(today, -(HEATMAP_DAYS - 1));

    const heatmapParts = heatmapStart.split("-").map(Number);
    const hy = heatmapParts[0] ?? 1970;
    const hm = heatmapParts[1] ?? 1;
    const hd = heatmapParts[2] ?? 1;
    const heatmapStartUtcMs =
        Date.UTC(hy, hm - 1, hd) - tzOffsetMinutes * 60_000;
    const heatmapStartIso = new Date(heatmapStartUtcMs).toISOString();

    const hourTotals = new Array<number>(24).fill(0);
    const heatmapCounts = new Map<string, number>();
    const daysSet = new Set<string>();
    const modelCounts = new Map<string, number>();

    const totals = {
        sessions: 0,
        userMessages: 0,
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
        activeDays: 0
    };

    const registry = listWorkspaces();

    for (const ws of registry.workspaces) {
        let db;
        try {
            db = getWorkspaceDb(ws.id);
        } catch {
            continue;
        }

        try {
            const sessionsRow = db
                .query("SELECT COUNT(*) AS c FROM conversations")
                .get() as CountRow | null;
            totals.sessions += sessionsRow?.c ?? 0;

            const totalsRow = db
                .query(
                    `SELECT
                        SUM(CASE WHEN role = 'user' AND compacted = 0 THEN 1 ELSE 0 END) AS user_messages,
                        COALESCE(SUM(input_tokens), 0) AS input_tokens,
                        COALESCE(SUM(output_tokens), 0) AS output_tokens,
                        COALESCE(SUM(reasoning_tokens), 0) AS reasoning_tokens,
                        COALESCE(SUM(total_tokens), 0) AS total_tokens
                    FROM messages`
                )
                .get() as TotalRow | null;

            if (totalsRow) {
                totals.userMessages += totalsRow.user_messages ?? 0;
                totals.inputTokens += totalsRow.input_tokens ?? 0;
                totals.outputTokens += totalsRow.output_tokens ?? 0;
                totals.reasoningTokens += totalsRow.reasoning_tokens ?? 0;
                totals.totalTokens += totalsRow.total_tokens ?? 0;
            }

            const hourRows = db
                .query(
                    `SELECT CAST(strftime('%H', created_at, ?) AS INTEGER) AS h, COUNT(*) AS c
                     FROM messages
                     WHERE role = 'user'
                     GROUP BY h`
                )
                .all(modifier) as HourRow[];
            for (const row of hourRows) {
                if (row.h >= 0 && row.h < 24) {
                    hourTotals[row.h] = (hourTotals[row.h] ?? 0) + row.c;
                }
            }

            const heatmapRows = db
                .query(
                    `SELECT date(created_at, ?) AS d, COUNT(*) AS c
                     FROM messages
                     WHERE role = 'user' AND created_at >= ?
                     GROUP BY d`
                )
                .all(modifier, heatmapStartIso) as DayRow[];
            for (const row of heatmapRows) {
                heatmapCounts.set(
                    row.d,
                    (heatmapCounts.get(row.d) ?? 0) + row.c
                );
            }

            const distinctDayRows = db
                .query(
                    `SELECT DISTINCT date(created_at, ?) AS d
                     FROM messages
                     WHERE role = 'user'`
                )
                .all(modifier) as DistinctDayRow[];
            for (const row of distinctDayRows) {
                if (row.d) daysSet.add(row.d);
            }

            const modelRows = db
                .query(
                    `SELECT model_id, COUNT(*) AS c
                     FROM messages
                     WHERE role = 'assistant' AND model_id IS NOT NULL AND model_id != ''
                     GROUP BY model_id`
                )
                .all() as ModelRow[];
            for (const row of modelRows) {
                modelCounts.set(
                    row.model_id,
                    (modelCounts.get(row.model_id) ?? 0) + row.c
                );
            }
        } catch {
            // ignore a single workspace failure and continue aggregating.
        }
    }

    totals.activeDays = daysSet.size;

    const streak = computeStreaks(daysSet, today);

    let mostActiveHour: number | null = null;
    let hourPeak = 0;
    for (let i = 0; i < 24; i++) {
        const h = hourTotals[i] ?? 0;
        if (h > hourPeak) {
            hourPeak = h;
            mostActiveHour = i;
        }
    }

    const models = Array.from(modelCounts.entries())
        .map(([id, count]) => {
            const meta = getModelById(id);
            return {
                id,
                label: meta?.displayName ?? id,
                count
            };
        })
        .sort((a, b) => b.count - a.count);

    const favoriteModel = models[0] ?? null;

    const days: { date: string; count: number }[] = [];
    for (let i = 0; i < HEATMAP_DAYS; i++) {
        const date = addDays(heatmapStart, i);
        days.push({ date, count: heatmapCounts.get(date) ?? 0 });
    }

    return {
        totals,
        streak,
        favoriteModel,
        models,
        hours: hourTotals,
        mostActiveHour,
        heatmap: {
            startDate: heatmapStart,
            endDate: today,
            days
        },
        workspaceCount: registry.workspaces.length
    };
}
