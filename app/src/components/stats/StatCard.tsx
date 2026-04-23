import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface StatCardProps {
    label: string;
    value: ReactNode;
    className?: string;
}

export function StatCard({ label, value, className }: StatCardProps) {
    return (
        <div
            className={cn(
                "flex flex-col gap-0.5 rounded-md bg-dark-850/60 px-2.5 py-2 min-w-0",
                className
            )}
        >
            <div className="text-[10.5px] font-medium text-dark-300 truncate">
                {label}
            </div>
            <div className="text-sm font-semibold tabular-nums text-dark-50 leading-tight truncate">
                {value}
            </div>
        </div>
    );
}
