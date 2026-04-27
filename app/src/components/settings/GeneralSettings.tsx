import { FolderLockIcon } from "@phosphor-icons/react";
import { useSettingsCategory } from "@/features/settings";
import { SettingHeader } from "./SettingHeader";
import { SettingGroup } from "./SettingGroup";
import { SettingRow } from "./SettingRow";
import { Switch } from "@/components/ui";

export function GeneralSettings() {
    const { settings, update } = useSettingsCategory("general");

    return (
        <div className="mx-auto w-full max-w-2xl px-10 pt-14 pb-16">
            <SettingHeader
                title="General"
                description="App-wide behavior toggles."
            />

            <SettingGroup>
                <SettingRow
                    icon={<FolderLockIcon size={16} weight="duotone" />}
                    label="Restrict tools to workspace"
                    description="When on, tools that take a path (glob, grep, write, str_replace, apply_patch, shell, diagnostics) refuse paths outside the active workspace. Turn off to let the assistant search and edit anywhere on the filesystem. read_file always accepts absolute paths regardless of this setting."
                >
                    <Switch
                        checked={settings.restrictToolsToWorkspace}
                        onCheckedChange={(restrictToolsToWorkspace) =>
                            void update({ restrictToolsToWorkspace })
                        }
                    />
                </SettingRow>
            </SettingGroup>
        </div>
    );
}
