import { type ElementType, useEffect } from "react";
import {
    BellIcon,
    BugIcon,
    KeyboardIcon,
    PlugsIcon,
    RobotIcon,
    ScrollIcon,
    ShieldCheckIcon,
    SlidersIcon
} from "@phosphor-icons/react";
import { GeneralSettings } from "./GeneralSettings";
import { HotkeySettings } from "./HotkeySettings";
import { CodexSettings } from "./CodexSettings";
import { DiagnosticsSettings } from "./DiagnosticsSettings";
import { McpServersSettings } from "./McpServersSettings";
import { NotificationsSettings } from "./NotificationsSettings";
import { RulesSettings } from "./RulesSettings";
import { ToolPermissionsSettings } from "./ToolPermissionsSettings";
import { useSettingsStore } from "./settings-store";

export type SettingsCategory = {
    key: string;
    label: string;
    icon: ElementType;
};

export const settingsCategories: SettingsCategory[] = [
    { key: "general", label: "General", icon: SlidersIcon },
    { key: "hotkeys", label: "Hotkeys", icon: KeyboardIcon },
    { key: "notifications", label: "Notifications", icon: BellIcon },
    { key: "rules", label: "Rules", icon: ScrollIcon },
    { key: "toolPermissions", label: "Tool permissions", icon: ShieldCheckIcon },
    { key: "mcpServers", label: "MCP servers", icon: PlugsIcon },
    { key: "codex", label: "Codex", icon: RobotIcon },
    { key: "diagnostics", label: "Diagnostics", icon: BugIcon }
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
                {activeCategory === "notifications" && (
                    <NotificationsSettings />
                )}
                {activeCategory === "rules" && <RulesSettings />}
                {activeCategory === "diagnostics" && (
                    <DiagnosticsSettings />
                )}
                {activeCategory === "codex" && <CodexSettings />}
                {activeCategory === "mcpServers" && <McpServersSettings />}
                {activeCategory === "toolPermissions" && (
                    <ToolPermissionsSettings />
                )}
            </div>
        </div>
    );
}
