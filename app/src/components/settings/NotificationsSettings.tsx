import {
    BellIcon,
    MonitorIcon,
    PlayIcon,
    SpeakerHighIcon
} from "@phosphor-icons/react";
import { useSettingsCategory } from "@/features/settings";
import { playSound, type NotificationKind } from "@/features/notifications";
import { SettingHeader } from "./SettingHeader";
import { SettingSection } from "./SettingSection";
import { SettingGroup } from "./SettingGroup";
import { SettingRow } from "./SettingRow";
import { Switch } from "@/components/ui";

const SOUND_PREVIEWS: { kind: NotificationKind; label: string; hint: string }[] = [
    { kind: "finish", label: "Assistant finished", hint: "Plays when a turn ends." },
    { kind: "permission", label: "Permission required", hint: "Plays when a tool needs approval." },
    { kind: "question", label: "Question asked", hint: "Plays when the assistant asks you something." }
];

export function NotificationsSettings() {
    const { settings, update } = useSettingsCategory("notifications");

    const masterOff = !settings.enabled;

    return (
        <div className="mx-auto w-full max-w-2xl px-10 pt-14 pb-16">
            <SettingHeader
                title="Notifications"
                description="Sounds and OS notifications fire only when the app window is unfocused."
            />

            <div className="flex flex-col gap-8">
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
                        description="A short distinct sound for each event type."
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

                <SettingSection
                    title="Preview sounds"
                    description="Listen to each cue without waiting for an event."
                >
                    <SettingGroup>
                        {SOUND_PREVIEWS.map((preview) => (
                            <div
                                key={preview.kind}
                                className="flex items-center justify-between gap-6 px-5 py-4"
                            >
                                <div className="flex min-w-0 flex-col gap-1">
                                    <span className="text-sm font-medium text-dark-50">
                                        {preview.label}
                                    </span>
                                    <span className="text-[13px] text-dark-300">
                                        {preview.hint}
                                    </span>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => playSound(preview.kind)}
                                    className="flex size-8 shrink-0 items-center justify-center rounded-md border border-dark-700 bg-dark-850 text-dark-100 transition-colors hover:border-dark-600 hover:bg-dark-800 hover:text-dark-50"
                                    aria-label={`Play ${preview.label}`}
                                >
                                    <PlayIcon size={12} weight="fill" />
                                </button>
                            </div>
                        ))}
                    </SettingGroup>
                </SettingSection>
            </div>
        </div>
    );
}
