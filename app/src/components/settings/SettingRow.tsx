import type { ReactNode } from "react";

interface SettingRowProps {
    icon?: ReactNode;
    label: string;
    description?: string;
    children: ReactNode;
}

export function SettingRow({
    icon,
    label,
    description,
    children
}: SettingRowProps) {
    return (
        <div className="flex items-center justify-between gap-6 px-5 py-4">
            <div className="flex min-w-0 items-start gap-3">
                {icon && (
                    <span className="mt-0.5 shrink-0 text-dark-200">
                        {icon}
                    </span>
                )}
                <div className="flex min-w-0 flex-col gap-1">
                    <span className="text-sm font-medium text-dark-50">
                        {label}
                    </span>
                    {description && (
                        <span className="text-[13px] leading-relaxed text-dark-300">
                            {description}
                        </span>
                    )}
                </div>
            </div>
            <div className="shrink-0">{children}</div>
        </div>
    );
}
