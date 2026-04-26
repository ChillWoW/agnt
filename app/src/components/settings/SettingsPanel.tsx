import { type ElementType, useEffect } from "react";
import {
    BellIcon,
    BugIcon,
    FileTextIcon,
    KeyboardIcon,
    PlugsIcon,
    RobotIcon,
    ShieldCheckIcon
} from "@phosphor-icons/react";
import { HotkeySettings } from "./HotkeySettings";
import { CodexSettings } from "./CodexSettings";
import { DiagnosticsSettings } from "./DiagnosticsSettings";
import { McpServersSettings } from "./McpServersSettings";
import { NotificationsSettings } from "./NotificationsSettings";
import { RepoInstructionsSettings } from "./RepoInstructionsSettings";
import { ToolPermissionsSettings } from "./ToolPermissionsSettings";
import { useSettingsStore } from "./settings-store";

export type SettingsCategory = {
    key: string;
    label: string;
    icon: ElementType;
};

export const settingsCategories: SettingsCategory[] = [
    { key: "hotkeys", label: "Hotkeys", icon: KeyboardIcon },
    { key: "notifications", label: "Notifications", icon: BellIcon },
    { key: "toolPermissions", label: "Tool permissions", icon: ShieldCheckIcon },
    { key: "mcpServers", label: "MCP servers", icon: PlugsIcon },
    { key: "codex", label: "Codex", icon: RobotIcon },
    { key: "diagnostics", label: "Diagnostics", icon: BugIcon },
    { key: "repoInstructions", label: "Repo instructions", icon: FileTextIcon }
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
                {activeCategory === "notifications" && (
                    <NotificationsSettings />
                )}
                {activeCategory === "diagnostics" && (
                    <DiagnosticsSettings />
                )}
                {activeCategory === "codex" && <CodexSettings />}
                {activeCategory === "mcpServers" && <McpServersSettings />}
                {activeCategory === "toolPermissions" && (
                    <ToolPermissionsSettings />
                )}
                {activeCategory === "repoInstructions" && (
                    <RepoInstructionsSettings />
                )}
            </div>
        </div>
    );
}
