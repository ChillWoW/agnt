import { create } from "zustand";
import type {
    HotkeyCombo,
    HotkeyDefinition,
    HotkeyHandler,
    HotkeyId
} from "./types";

export type HotkeyRegistration = {
    token: string;
    id: HotkeyId;
    enabled: boolean;
    preventDefault: boolean;
    order: number;
    handler: HotkeyHandler;
};

type HotkeysState = {
    disabled: boolean;
    definitions: Record<string, HotkeyDefinition>;
    bindings: Partial<Record<string, HotkeyCombo | null>>;
    registrations: HotkeyRegistration[];
    registrationsByToken: Map<string, HotkeyRegistration>;
    upsertDefinition: (definition: HotkeyDefinition) => void;
    setBindings: (bindings: Partial<Record<string, HotkeyCombo | null>>) => void;
    registerHotkey: (registration: Omit<HotkeyRegistration, "order">) => void;
    unregisterHotkey: (token: string) => void;
    setDisabled: (disabled: boolean) => void;
};

let nextOrder = 0;

export const useHotkeysStore = create<HotkeysState>((set) => ({
    disabled: false,
    definitions: {},
    bindings: {},
    registrations: [],
    registrationsByToken: new Map(),

    upsertDefinition: (definition) => {
        set((state) => ({
            definitions: {
                ...state.definitions,
                [definition.id]: definition
            }
        }));
    },

    setBindings: (bindings) => {
        set({ bindings });
    },

    registerHotkey: (incoming) => {
        nextOrder += 1;
        const registration: HotkeyRegistration = { ...incoming, order: nextOrder };

        set((state) => {
            const filtered = state.registrations.filter((r) => r.token !== incoming.token);
            // Insert keeping descending order (highest order first for priority dispatch)
            const registrations = [...filtered, registration].sort(
                (a, b) => b.order - a.order
            );

            const byToken = new Map(state.registrationsByToken);
            byToken.set(incoming.token, registration);

            return { registrations, registrationsByToken: byToken };
        });
    },

    unregisterHotkey: (token) => {
        set((state) => {
            const byToken = new Map(state.registrationsByToken);
            byToken.delete(token);

            return {
                registrations: state.registrations.filter((r) => r.token !== token),
                registrationsByToken: byToken
            };
        });
    },

    setDisabled: (disabled) => {
        set({ disabled });
    }
}));

export function getResolvedHotkeyCombo(
    state: Pick<HotkeysState, "bindings" | "definitions">,
    id: HotkeyId
): HotkeyCombo | null {
    if (Object.prototype.hasOwnProperty.call(state.bindings, id)) {
        return state.bindings[id] ?? null;
    }
    return state.definitions[id]?.defaultCombo ?? null;
}

export function disableHotkeys(disabled: boolean) {
    useHotkeysStore.getState().setDisabled(disabled);
}
