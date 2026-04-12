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
        <div className="flex items-center justify-between gap-2 p-3">
            <div className="flex items-start gap-3">
                {icon && (
                    <span className="shrink-0 text-dark-300 self-center">
                        {icon}
                    </span>
                )}
                <div className="flex flex-col gap-0.5">
                    <span className="text-[13px] font-medium text-dark-50">
                        {label}
                    </span>
                    {description && (
                        <span className="text-xs text-dark-300">
                            {description}
                        </span>
                    )}
                </div>
            </div>
            <div className="shrink-0">{children}</div>
        </div>
    );
}
