export type HotkeyId = `${string}.${string}`;
export type HotkeyCombo = string;

export type HotkeyHandler = (event: KeyboardEvent) => void;

export interface HotkeyDefinition {
    id: HotkeyId;
    label: string;
    description?: string;
    defaultCombo: HotkeyCombo | null;
}

export interface UseHotkeyOptions extends HotkeyDefinition {
    handler: HotkeyHandler;
    enabled?: boolean;
    preventDefault?: boolean;
}
