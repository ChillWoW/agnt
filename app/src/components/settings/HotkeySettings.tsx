import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { useSettingsStore } from "@/features/settings";
import {
    disableHotkeys,
    useHotkeysStore,
    getHotkeyCategory,
    getEventHotkeyCombo,
    HotkeyShortcut
} from "@/features/hotkeys";
import type { HotkeyCombo, HotkeyDefinition, HotkeyId } from "@/features/hotkeys";
import { SettingHeader } from "./SettingHeader";
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
    const hotkeyBindings = useSettingsStore((s) => s.settings.hotkeys?.bindings ?? {});
    const setHotkeyBinding = useSettingsStore((s) => s.setHotkeyBinding);
    const resetHotkeyBinding = useSettingsStore((s) => s.resetHotkeyBinding);

    const [recordingId, setRecordingId] = useState<HotkeyId | null>(null);
    const [recordingMessage, setRecordingMessage] = useState<string | null>(null);

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
        return () => window.removeEventListener("keydown", handleKeyDown, true);
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

    const resolveCombo = (hotkey: HotkeyDefinition): HotkeyCombo | null => {
        if (Object.prototype.hasOwnProperty.call(hotkeyBindings, hotkey.id)) {
            return hotkeyBindings[hotkey.id] ?? null;
        }
        return hotkey.defaultCombo;
    };

    const isCustom = (id: string) =>
        Object.prototype.hasOwnProperty.call(hotkeyBindings, id);

    const hasDefinitions = groups.length > 0;

    return (
        <div className="mx-auto w-full max-w-xl p-8">
            <SettingHeader
                title="Hotkeys"
                description="View and customize keyboard shortcuts."
            />

            {!hasDefinitions && (
                <div className="rounded-md border border-dark-700 bg-dark-900 p-6 text-center">
                    <p className="text-sm text-dark-300">
                        No hotkeys registered yet. Hotkeys will appear here once
                        features register their shortcuts.
                    </p>
                </div>
            )}

            <div className="flex flex-col gap-4">
                {groups.map((group) => (
                    <div key={group.category}>
                        <p className="mb-2 text-xs font-semibold uppercase text-dark-300">
                            {toCategoryLabel(group.category)}
                        </p>

                        <SettingGroup>
                            {group.items.map((hotkey) => {
                                const value = resolveCombo(hotkey);
                                const isRecording = recordingId === hotkey.id;
                                const custom = isCustom(hotkey.id);

                                return (
                                    <div
                                        key={hotkey.id}
                                        className="flex items-center justify-between gap-2 p-3"
                                    >
                                        <div className="flex flex-col gap-0.5">
                                            <span className="text-[13px] font-medium text-dark-50">
                                                {hotkey.label}
                                            </span>
                                            {hotkey.description && (
                                                <span className="text-xs text-dark-300">
                                                    {hotkey.description}
                                                </span>
                                            )}
                                        </div>

                                        <div className="flex shrink-0 items-center gap-1.5">
                                            {custom && !isRecording && (
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        resetHotkeyBinding(hotkey.id)
                                                    }
                                                    className="cursor-pointer rounded px-1.5 py-0.5 text-[10px] text-dark-400 transition-colors hover:text-dark-200"
                                                >
                                                    Reset
                                                </button>
                                            )}

                                            <button
                                                type="button"
                                                onClick={() =>
                                                    isRecording
                                                        ? stopRecording()
                                                        : startRecording(hotkey.id)
                                                }
                                                className={cn(
                                                    "cursor-pointer rounded-md px-2 py-1 text-xs transition-colors",
                                                    isRecording
                                                        ? "ring-1 ring-primary-400 text-primary-300 bg-primary-400/10"
                                                        : "text-dark-200 hover:bg-dark-700 hover:text-dark-50"
                                                )}
                                            >
                                                {isRecording ? (
                                                    <span className="animate-pulse">
                                                        Press keys...
                                                    </span>
                                                ) : (
                                                    <HotkeyShortcut combo={value} />
                                                )}
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </SettingGroup>
                    </div>
                ))}
            </div>

            {recordingId && (
                <div className="mt-4 text-center text-xs text-dark-300">
                    {recordingMessage ?? (
                        <>
                            <span className="text-dark-100">Del</span> clears
                            {" "}&middot;{" "}
                            <span className="text-dark-100">Esc</span> cancels
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
