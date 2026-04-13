import {
    RocketLaunchIcon,
    TrayArrowDownIcon,
    WarningCircleIcon
} from "@phosphor-icons/react";
import { Switch } from "@/components/ui";
import { useSettings } from "@/features/settings";
import { SettingGroup } from "./SettingGroup";
import { SettingHeader } from "./SettingHeader";
import { SettingRow } from "./SettingRow";

export function GeneralSettings() {
    const { settings, updateCategory } = useSettings();
    const general = settings.general;

    return (
        <div className="mx-auto w-full max-w-xl p-8">
            <SettingHeader
                title="General"
                description="Core application behavior and preferences."
            />

            <SettingGroup>
                <SettingRow
                    icon={<RocketLaunchIcon size={18} weight="duotone" />}
                    label="Launch at startup"
                    description="Automatically start Agnt when you log in."
                >
                    <Switch
                        checked={general.launchAtStartup}
                        onCheckedChange={(checked) =>
                            void updateCategory("general", { launchAtStartup: checked })
                        }
                    />
                </SettingRow>

                <SettingRow
                    icon={<TrayArrowDownIcon size={18} weight="duotone" />}
                    label="Minimize to tray"
                    description="Keep running in the system tray when the window is closed."
                >
                    <Switch
                        checked={general.minimizeToTray}
                        onCheckedChange={(checked) =>
                            void updateCategory("general", { minimizeToTray: checked })
                        }
                    />
                </SettingRow>

                <SettingRow
                    icon={<WarningCircleIcon size={18} weight="duotone" />}
                    label="Confirm on close"
                    description="Show a confirmation dialog before quitting the app."
                >
                    <Switch
                        checked={general.confirmOnClose}
                        onCheckedChange={(checked) =>
                            void updateCategory("general", { confirmOnClose: checked })
                        }
                    />
                </SettingRow>
            </SettingGroup>
        </div>
    );
}
