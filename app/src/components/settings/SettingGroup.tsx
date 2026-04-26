import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface SettingGroupProps {
    children: ReactNode;
    className?: string;
}

export function SettingGroup({ children, className }: SettingGroupProps) {
    return (
        <div
            className={cn(
                "flex flex-col divide-y divide-dark-800 rounded-lg border border-dark-700 bg-dark-900",
                className
            )}
        >
            {children}
        </div>
    );
}
