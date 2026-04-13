import { cn } from "@/lib/cn";
import { useOS } from "@/lib/useOS";
import { formatHotkeyCombo } from "./hotkeys-utils";
import type { HotkeyCombo } from "./types";

interface HotkeyShortcutProps {
    combo: HotkeyCombo | null | undefined;
    className?: string;
    emptyLabel?: string;
}

export function HotkeyShortcut({
    combo,
    className,
    emptyLabel = "Unassigned"
}: HotkeyShortcutProps) {
    const os = useOS();
    const tokens = formatHotkeyCombo(combo, os);

    if (tokens.length === 0) {
        return (
            <span className={cn("text-xs text-dark-300", className)}>
                {emptyLabel}
            </span>
        );
    }

    return (
        <span className={cn("inline-flex items-center gap-1", className)}>
            {tokens.map((token) => (
                <kbd
                    key={`${combo}-${token}`}
                    className="inline-flex min-w-5 items-center justify-center rounded-sm border border-dark-600 bg-dark-900 px-1.5 py-0.5 font-mono text-[10px] font-medium text-dark-100"
                >
                    {token}
                </kbd>
            ))}
        </span>
    );
}
