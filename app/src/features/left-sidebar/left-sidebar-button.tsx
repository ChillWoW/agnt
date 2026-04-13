import { cn } from "@/lib/cn";

interface LeftSidebarButtonProps {
    Icon: React.ElementType;
    label: string;
    onClick: () => void;
    hotkey?: string;
    isActive?: boolean;
}

export function LeftSidebarButton({
    Icon,
    label,
    onClick,
    hotkey,
    isActive = false
}: LeftSidebarButtonProps) {
    return (
        <button
            className={cn(
                "group shrink-0 flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors",
                isActive
                    ? "bg-dark-800 text-dark-50"
                    : "hover:bg-dark-700 text-dark-100 hover:text-dark-50"
            )}
            onClick={onClick}
        >
            <div className="flex items-center gap-2">
                <span>
                    <Icon className="size-4" />
                </span>
                <span className="truncate">{label}</span>
            </div>

            <span className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-dark-200 text-xs">
                {hotkey}
            </span>
        </button>
    );
}
