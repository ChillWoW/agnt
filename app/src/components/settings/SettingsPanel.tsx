import { type ElementType, useEffect } from "react";
import {
    KeyboardIcon,
    RobotIcon,
    ShieldCheckIcon
} from "@phosphor-icons/react";
import { HotkeySettings } from "./HotkeySettings";
import { CodexSettings } from "./CodexSettings";
import { ToolPermissionsSettings } from "./ToolPermissionsSettings";
import { useSettingsStore } from "./settings-store";

export type SettingsCategory = {
    key: string;
    label: string;
    icon: ElementType;
    group: string;
};

export const settingsCategories: SettingsCategory[] = [
    {
        key: "hotkeys",
        label: "Hotkeys",
        icon: KeyboardIcon,
        group: "Desktop"
    },
    {
        key: "codex",
        label: "Codex",
        icon: RobotIcon,
        group: "AI"
    },
    {
        key: "toolPermissions",
        label: "Tool permissions",
        icon: ShieldCheckIcon,
        group: "AI"
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
                {activeCategory === "hotkeys" && <HotkeySettings />}
                {activeCategory === "codex" && <CodexSettings />}
                {activeCategory === "toolPermissions" && (
                    <ToolPermissionsSettings />
                )}
            </div>
        </div>
    );
}
