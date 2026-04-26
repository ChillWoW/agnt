import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { useSettingsStore } from "@/features/settings";
import {
    disableHotkeys,
    useHotkeysStore,
    getHotkeyCategory,
    getEventHotkeyCombo,
    HotkeyShortcut
} from "@/features/hotkeys";
import type {
    HotkeyCombo,
    HotkeyDefinition,
    HotkeyId
} from "@/features/hotkeys";
import { SettingHeader } from "./SettingHeader";
import { SettingSection } from "./SettingSection";
import { SettingGroup } from "./SettingGroup";

type HotkeyGroup = {
    category: string;
    items: HotkeyDefinition[];
};

function toCategoryLabel(category: string) {
    return category.charAt(0).toUpperCase() + category.slice(1);
}

export function HotkeySettings() {
    const definitions = useHotkeysStore((s) => s.definitions);
    const hotkeyBindings = useSettingsStore(
        (s) => s.settings.hotkeys?.bindings ?? {}
    );
    const setHotkeyBinding = useSettingsStore((s) => s.setHotkeyBinding);
    const resetHotkeyBinding = useSettingsStore((s) => s.resetHotkeyBinding);

    const [recordingId, setRecordingId] = useState<HotkeyId | null>(null);
    const [recordingMessage, setRecordingMessage] = useState<string | null>(
        null
    );

    const stopRecording = useCallback(() => {
        disableHotkeys(false);
        setRecordingId(null);
        setRecordingMessage(null);
    }, []);

    const startRecording = useCallback((id: HotkeyId) => {
        disableHotkeys(true);
        setRecordingId(id);
        setRecordingMessage(null);
    }, []);

    useEffect(() => {
        if (!recordingId) return;

        const handleKeyDown = (event: KeyboardEvent) => {
            event.preventDefault();
            event.stopPropagation();

            if (
                event.key === "Escape" &&
                !event.ctrlKey &&
                !event.metaKey &&
                !event.altKey &&
                !event.shiftKey
            ) {
                stopRecording();
                return;
            }

            if (
                (event.key === "Backspace" || event.key === "Delete") &&
                !event.ctrlKey &&
                !event.metaKey &&
                !event.altKey &&
                !event.shiftKey
            ) {
                setHotkeyBinding(recordingId, null);
                stopRecording();
                return;
            }

            const combo = getEventHotkeyCombo(event);

            if (!combo) {
                setRecordingMessage("Press a modifier + key");
                return;
            }

            setHotkeyBinding(recordingId, combo);
            stopRecording();
        };

        window.addEventListener("keydown", handleKeyDown, true);
        return () =>
            window.removeEventListener("keydown", handleKeyDown, true);
    }, [recordingId, stopRecording, setHotkeyBinding]);

    useEffect(() => {
        return () => {
            disableHotkeys(false);
        };
    }, []);

    const groups = useMemo<HotkeyGroup[]>(() => {
        const active = Object.values(definitions)
            .filter((d): d is HotkeyDefinition => Boolean(d))
            .sort((a, b) => a.id.localeCompare(b.id));

        const grouped = new Map<string, HotkeyDefinition[]>();

        for (const def of active) {
            const cat = getHotkeyCategory(def.id);
            const items = grouped.get(cat) ?? [];
            items.push(def);
            grouped.set(cat, items);
        }

        return [...grouped.entries()].map(([category, items]) => ({
            category,
            items
        }));
    }, [definitions]);

    const resolveCombo = (
        hotkey: HotkeyDefinition
    ): HotkeyCombo | null => {
        if (Object.prototype.hasOwnProperty.call(hotkeyBindings, hotkey.id)) {
            return hotkeyBindings[hotkey.id] ?? null;
        }
        return hotkey.defaultCombo;
    };

    const isCustom = (id: string) =>
        Object.prototype.hasOwnProperty.call(hotkeyBindings, id);

    const hasDefinitions = groups.length > 0;

    return (
        <div className="mx-auto w-full max-w-2xl px-10 pt-14 pb-16">
            <SettingHeader
                title="Hotkeys"
                description="Click any shortcut to record a new combo. Press Delete to clear, Esc to cancel."
            />

            {!hasDefinitions ? (
                <div className="rounded-lg border border-dark-700 bg-dark-900 px-6 py-12 text-center">
                    <p className="text-sm text-dark-300">
                        No hotkeys registered yet.
                    </p>
                </div>
            ) : (
                <div className="flex flex-col gap-8">
                    {groups.map((group) => (
                        <SettingSection
                            key={group.category}
                            title={toCategoryLabel(group.category)}
                        >
                            <SettingGroup>
                                {group.items.map((hotkey) => {
                                    const value = resolveCombo(hotkey);
                                    const isRecording =
                                        recordingId === hotkey.id;
                                    const custom = isCustom(hotkey.id);

                                    return (
                                        <div
                                            key={hotkey.id}
                                            className="flex items-center justify-between gap-4 px-5 py-3.5"
                                        >
                                            <div className="flex min-w-0 flex-col gap-0.5">
                                                <span className="text-sm font-medium text-dark-50">
                                                    {hotkey.label}
                                                </span>
                                                {hotkey.description && (
                                                    <span className="text-[12px] text-dark-300">
                                                        {hotkey.description}
                                                    </span>
                                                )}
                                            </div>

                                            <div className="flex shrink-0 items-center gap-1">
                                                {custom && !isRecording && (
                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            resetHotkeyBinding(
                                                                hotkey.id
                                                            )
                                                        }
                                                        title="Reset to default"
                                                        className="flex size-7 items-center justify-center rounded-md text-dark-400 transition-colors hover:bg-dark-800 hover:text-dark-100"
                                                    >
                                                        <ArrowCounterClockwiseIcon
                                                            size={12}
                                                            weight="bold"
                                                        />
                                                    </button>
                                                )}

                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        isRecording
                                                            ? stopRecording()
                                                            : startRecording(
                                                                  hotkey.id
                                                              )
                                                    }
                                                    className={cn(
                                                        "flex h-7 min-w-20 items-center justify-center rounded-md border px-2 transition-colors",
                                                        isRecording
                                                            ? "border-dark-500 bg-dark-800 text-dark-50"
                                                            : "border-dark-700 bg-dark-850 text-dark-100 hover:border-dark-600 hover:bg-dark-800"
                                                    )}
                                                >
                                                    {isRecording ? (
                                                        <span className="text-[11px] text-dark-200 wave-text">
                                                            Press keys…
                                                        </span>
                                                    ) : (
                                                        <HotkeyShortcut
                                                            combo={value}
                                                        />
                                                    )}
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </SettingGroup>
                        </SettingSection>
                    ))}
                </div>
            )}

            <div
                className={cn(
                    "mt-8 text-center text-[12px] text-dark-400 transition-opacity",
                    recordingId ? "opacity-100" : "opacity-0"
                )}
                aria-hidden={!recordingId}
            >
                {recordingMessage ??
                    "Press the new combo · Del to clear · Esc to cancel"}
            </div>
        </div>
    );
}
