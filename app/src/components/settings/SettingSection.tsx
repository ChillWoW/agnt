import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface SettingSectionProps {
    title: string;
    description?: string;
    aside?: ReactNode;
    children: ReactNode;
    className?: string;
}

export function SettingSection({
    title,
    description,
    aside,
    children,
    className
}: SettingSectionProps) {
    return (
        <section className={cn("flex flex-col gap-3", className)}>
            <div className="flex items-start justify-between gap-4 px-1">
                <div className="flex flex-col gap-1">
                    <h2 className="text-[13px] font-medium text-dark-100">
                        {title}
                    </h2>
                    {description && (
                        <p className="text-[12px] leading-relaxed text-dark-300">
                            {description}
                        </p>
                    )}
                </div>
                {aside && <div className="shrink-0">{aside}</div>}
            </div>
            {children}
        </section>
    );
}
