import { cn } from "@/lib/cn";
import { Tooltip } from "@/components/ui";

interface UsageHeatmapProps {
    days: { date: string; count: number }[];
    rows?: number;
}

const MONTHS = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec"
];

function parseLocalDate(d: string): Date {
    const [y, m, day] = d.split("-").map(Number);
    return new Date(y ?? 1970, (m ?? 1) - 1, day ?? 1);
}

function formatDay(d: string): string {
    const dt = parseLocalDate(d);
    return `${MONTHS[dt.getMonth()]} ${dt.getDate()}`;
}

function tierClass(count: number, max: number): string {
    if (count === 0) return "bg-dark-800";
    const ratio = count / max;
    if (ratio >= 0.75) return "bg-blue-400";
    if (ratio >= 0.5) return "bg-blue-500";
    if (ratio >= 0.25) return "bg-blue-600";
    return "bg-blue-700/90";
}

export function UsageHeatmap({ days, rows = 7 }: UsageHeatmapProps) {
    const max = Math.max(...days.map((d) => d.count), 1);

    // Grid of `rows` rows × N columns, filled column-first oldest → newest.
    const columns: ({ date: string; count: number } | null)[][] = [];
    const total = days.length;
    const colCount = Math.max(1, Math.ceil(total / rows));

    for (let c = 0; c < colCount; c++) {
        const col: ({ date: string; count: number } | null)[] = [];
        for (let r = 0; r < rows; r++) {
            const idx = c * rows + r;
            col.push(idx < total ? days[idx]! : null);
        }
        columns.push(col);
    }

    return (
        <div className="w-full">
            <div
                className="flex gap-[2px] w-full"
                style={{ aspectRatio: `${colCount} / ${rows + 0.2}` }}
            >
                {columns.map((col, ci) => (
                    <div
                        key={ci}
                        className="flex flex-1 flex-col gap-[2px] min-w-0"
                    >
                        {col.map((cell, ri) =>
                            cell ? (
                                <Tooltip
                                    key={ri}
                                    content={
                                        <span className="tabular-nums">
                                            {formatDay(cell.date)} ·{" "}
                                            {cell.count}{" "}
                                            {cell.count === 1
                                                ? "message"
                                                : "messages"}
                                        </span>
                                    }
                                    side="top"
                                    delay={80}
                                >
                                    <div
                                        className={cn(
                                            "aspect-square rounded-[2px] transition-colors",
                                            tierClass(cell.count, max)
                                        )}
                                    />
                                </Tooltip>
                            ) : (
                                <div
                                    key={ri}
                                    className="aspect-square rounded-[2px] bg-transparent"
                                />
                            )
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}
