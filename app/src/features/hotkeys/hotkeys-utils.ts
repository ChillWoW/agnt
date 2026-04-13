import type { OS } from "@/lib/useOS";
import type { HotkeyCombo, HotkeyId } from "./types";

const MODIFIER_ORDER = ["Ctrl", "Shift", "Alt", "Meta"] as const;
const MODIFIER_SET = new Set<string>(MODIFIER_ORDER);

const KEY_ALIASES: Record<string, string> = {
    control: "Ctrl",
    ctrl: "Ctrl",
    shift: "Shift",
    alt: "Alt",
    option: "Alt",
    meta: "Meta",
    cmd: "Meta",
    command: "Meta",
    escape: "Esc",
    esc: "Esc",
    enter: "Enter",
    return: "Enter",
    tab: "Tab",
    space: "Space",
    " ": "Space",
    spacebar: "Space",
    delete: "Delete",
    del: "Delete",
    backspace: "Backspace",
    insert: "Insert",
    home: "Home",
    end: "End",
    pageup: "PageUp",
    pagedown: "PageDown",
    arrowup: "Up",
    arrowdown: "Down",
    arrowleft: "Left",
    arrowright: "Right",
    ",": ",",
    ".": ".",
    "/": "/",
    "\\": "\\",
    "-": "-",
    "=": "=",
    ";": ";",
    "'": "'",
    "[": "[",
    "]": "]",
    "`": "`"
};

function normalizeToken(raw: string): string | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;

    const alias = KEY_ALIASES[trimmed.toLowerCase()];
    if (alias) return alias;

    if (/^f\d{1,2}$/i.test(trimmed)) return trimmed.toUpperCase();
    if (trimmed.length === 1) return trimmed.toUpperCase();

    return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`;
}

function sortModifiers(tokens: string[]): string[] {
    return [...tokens].sort(
        (a, b) =>
            MODIFIER_ORDER.indexOf(a as (typeof MODIFIER_ORDER)[number]) -
            MODIFIER_ORDER.indexOf(b as (typeof MODIFIER_ORDER)[number])
    );
}

function isModifier(token: string): boolean {
    return MODIFIER_SET.has(token);
}

export function parseHotkeyCombo(combo: HotkeyCombo | null | undefined): string[] | null {
    if (!combo) return null;

    const tokens = combo
        .split("+")
        .map(normalizeToken)
        .filter((t): t is string => t !== null);

    if (tokens.length < 2 || tokens.length > 3) return null;
    if (new Set(tokens).size !== tokens.length) return null;

    const modifiers = tokens.filter(isModifier);
    const primaries = tokens.filter((t) => !isModifier(t));

    if (primaries.length !== 1) return null;

    return [...sortModifiers(modifiers), primaries[0]];
}

export function normalizeHotkeyCombo(combo: HotkeyCombo | null | undefined): string | null {
    const tokens = parseHotkeyCombo(combo);
    return tokens ? tokens.join("+") : null;
}

export function getEventHotkeyCombo(event: KeyboardEvent): string | null {
    const key = normalizeToken(event.key);
    if (!key || isModifier(key)) return null;

    const tokens = [
        event.ctrlKey ? "Ctrl" : null,
        event.shiftKey ? "Shift" : null,
        event.altKey ? "Alt" : null,
        event.metaKey ? "Meta" : null,
        key
    ].filter((t): t is string => t !== null);

    if (tokens.length < 2 || tokens.length > 3) return null;

    return normalizeHotkeyCombo(tokens.join("+"));
}

export function matchesHotkeyCombo(
    combo: HotkeyCombo | null | undefined,
    event: KeyboardEvent
): boolean {
    const normalized = normalizeHotkeyCombo(combo);
    const eventCombo = getEventHotkeyCombo(event);
    return Boolean(normalized && eventCombo && normalized === eventCombo);
}

export function formatHotkeyCombo(
    combo: HotkeyCombo | null | undefined,
    os: OS = "unknown"
): string[] {
    const tokens = parseHotkeyCombo(combo);
    if (!tokens) return [];

    return tokens.map((token) => {
        if (token === "Meta") return os === "macos" ? "Cmd" : "Win";
        if (token === "Alt") return os === "macos" ? "Opt" : "Alt";
        return token;
    });
}

export function formatHotkey(
    combo: HotkeyCombo | null | undefined,
    os: OS = "unknown"
): string {
    return formatHotkeyCombo(combo, os).join("+");
}

export function getHotkeyCategory(id: HotkeyId): string {
    return id.split(".")[0] ?? "general";
}

export function isHotkeyEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return false;

    return Boolean(
        target.closest(
            'input, textarea, select, [contenteditable="true"], [contenteditable=""], [role="textbox"], [data-hotkeys-ignore="true"]'
        )
    );
}
