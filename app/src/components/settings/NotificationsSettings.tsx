import {
    BellIcon,
    MusicNoteIcon,
    MonitorIcon,
    SpeakerHighIcon
} from "@phosphor-icons/react";
import { useSettingsCategory } from "@/features/settings";
import { playSound, type NotificationKind } from "@/features/notifications";
import { SettingHeader } from "./SettingHeader";
import { SettingGroup } from "./SettingGroup";
import { SettingRow } from "./SettingRow";
import { Switch, Button } from "@/components/ui";

const SOUND_PREVIEWS: { kind: NotificationKind; label: string }[] = [
    { kind: "finish", label: "Assistant finished" },
    { kind: "permission", label: "Permission required" },
    { kind: "question", label: "Question asked" }
];

export function NotificationsSettings() {
    const { settings, update } = useSettingsCategory("notifications");

    const masterOff = !settings.enabled;

    return (
        <div className="mx-auto w-full max-w-xl p-8">
            <SettingHeader
                title="Notifications"
                description="Play a sound and show a system notification when the assistant finishes, needs permission, or asks a question. Fires only when the app window is not focused."
            />

            <div className="flex flex-col gap-6">
                <SettingGroup>
                    <SettingRow
                        icon={<BellIcon size={16} weight="duotone" />}
                        label="Enable notifications"
                        description="Master switch for sounds and system notifications."
                    >
                        <Switch
                            checked={settings.enabled}
                            onCheckedChange={(enabled) =>
                                void update({ enabled })
                            }
                        />
                    </SettingRow>
                    <SettingRow
                        icon={<SpeakerHighIcon size={16} weight="duotone" />}
                        label="Play sounds"
                        description="Short distinct sound per event type."
                    >
                        <Switch
                            disabled={masterOff}
                            checked={settings.soundEnabled}
                            onCheckedChange={(soundEnabled) =>
                                void update({ soundEnabled })
                            }
                        />
                    </SettingRow>
                    <SettingRow
                        icon={<MonitorIcon size={16} weight="duotone" />}
                        label="System notifications"
                        description="Show an OS notification when the window is unfocused."
                    >
                        <Switch
                            disabled={masterOff}
                            checked={settings.osNotificationsEnabled}
                            onCheckedChange={(osNotificationsEnabled) =>
                                void update({ osNotificationsEnabled })
                            }
                        />
                    </SettingRow>
                </SettingGroup>

                <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2 text-[11px] font-medium text-dark-300 uppercase tracking-wide">
                        <MusicNoteIcon size={12} weight="duotone" />
                        Preview sounds
                    </div>
                    <SettingGroup>
                        {SOUND_PREVIEWS.map((preview) => (
                            <SettingRow
                                key={preview.kind}
                                label={preview.label}
                                description={`Plays ${preview.kind}.wav`}
                            >
                                <Button
                                    size="sm"
                                    variant="secondary"
                                    onClick={() => playSound(preview.kind)}
                                >
                                    Play
                                </Button>
                            </SettingRow>
                        ))}
                    </SettingGroup>
                </div>
            </div>
        </div>
    );
}
