import { type ElementType, useEffect } from "react";
import { GearIcon, KeyboardIcon } from "@phosphor-icons/react";
import { GeneralSettings } from "./GeneralSettings";
import { HotkeySettings } from "./HotkeySettings";
import { useSettingsStore } from "./settings-store";

export type SettingsCategory = {
    key: string;
    label: string;
    icon: ElementType;
    group: string;
};

export const settingsCategories: SettingsCategory[] = [
    {
        key: "general",
        label: "General",
        icon: GearIcon,
        group: "Desktop"
    },
    {
        key: "hotkeys",
        label: "Hotkeys",
        icon: KeyboardIcon,
        group: "Desktop"
    }
];

export function SettingsPanel() {
    const { isOpen, activeCategory, close } = useSettingsStore();

    useEffect(() => {
        if (!isOpen) return;
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") close();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [isOpen, close]);

    if (!isOpen) return null;

    return (
        <div className="absolute inset-0 z-30 bg-dark-950">
            <div className="h-full overflow-y-auto">
                {activeCategory === "general" && <GeneralSettings />}
                {activeCategory === "hotkeys" && <HotkeySettings />}
            </div>
        </div>
    );
}
