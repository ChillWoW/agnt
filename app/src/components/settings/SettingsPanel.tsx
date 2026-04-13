import { useEffect, type ReactNode } from "react";
import { GearIcon, KeyboardIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { GeneralSettings } from "./GeneralSettings";
import { HotkeySettings } from "./HotkeySettings";

export type SettingsCategory = {
    key: string;
    label: string;
    icon: ReactNode;
    group: string;
};

export const settingsCategories: SettingsCategory[] = [
    {
        key: "general",
        label: "General",
        icon: <GearIcon size={16} weight="duotone" />,
        group: "Desktop"
    },
    {
        key: "hotkeys",
        label: "Hotkeys",
        icon: <KeyboardIcon size={16} weight="duotone" />,
        group: "Desktop"
    }
];

interface SettingsPanelProps {
    open: boolean;
    onClose: () => void;
    activeCategory: string;
}

export function SettingsPanel({ open, onClose, activeCategory }: SettingsPanelProps) {
    useEffect(() => {
        if (!open) return;
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [open, onClose]);

    if (!open) return null;

    return (
        <div
            className={cn(
                "absolute inset-0 z-30 bg-dark-950",
                "animate-in fade-in-0 duration-150 ease-out"
            )}
        >
            <div className="h-full overflow-y-auto">
                {activeCategory === "general" && <GeneralSettings />}
                {activeCategory === "hotkeys" && <HotkeySettings />}
            </div>
        </div>
    );
}
