import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";

const GRID_SIZE = 3;
const CELL_COUNT = GRID_SIZE * GRID_SIZE;

function generatePattern(): number[] {
    const pattern: number[] = [];
    for (let i = 0; i < CELL_COUNT; i++) {
        pattern.push(Math.random() < 0.5 ? 0 : 1);
    }
    return pattern;
}

export function BinaryMatrix({ className }: { className?: string }) {
    const [pattern, setPattern] = useState<number[]>(() => generatePattern());

    useEffect(() => {
        let timeoutId: ReturnType<typeof setTimeout>;

        const tick = () => {
            setPattern(generatePattern());
            const delay = 200 + Math.random() * 200;
            timeoutId = setTimeout(tick, delay);
        };

        const initialDelay = 200 + Math.random() * 200;
        timeoutId = setTimeout(tick, initialDelay);

        return () => clearTimeout(timeoutId);
    }, []);

    return (
        <div
            className={cn(
                "grid size-2.5 shrink-0 place-items-center gap-px",
                className
            )}
            style={{
                gridTemplateColumns: `repeat(${GRID_SIZE}, 1fr)`,
                gridTemplateRows: `repeat(${GRID_SIZE}, 1fr)`
            }}
            aria-hidden="true"
        >
            {pattern.map((bit, i) => (
                <span
                    key={i}
                    className={cn(
                        "size-[2px] rounded-full transition-colors",
                        bit === 1 ? "bg-dark-50" : "bg-transparent"
                    )}
                />
            ))}
        </div>
    );
}
