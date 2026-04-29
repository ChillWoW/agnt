import { create } from "zustand";
import { api, toApiErrorMessage } from "@/lib/api";
import { toast } from "@/components/ui";
import type { Rule } from "@/typings/rules";

// ─── Rules store ──────────────────────────────────────────────────────────────
//
// Mirrors the optimistic-update pattern of `useSettingsStore` but for a list
// of independent records instead of a single settings tree. Each mutation
// snapshots the previous list, applies the optimistic state immediately,
// then either commits the server's authoritative response or rolls back on
// failure.
//
// Order in the local list matches what the server returns (newest-first by
// file mtime). After an update we re-sort locally so a freshly edited rule
// jumps back to the top — saves a roundtrip just to refresh order.

interface RulesState {
    rules: Rule[];
    isLoading: boolean;
    isFetching: boolean;
    error: string | null;
    hasFetched: boolean;
    fetchRules: () => Promise<void>;
    createRule: (body?: string) => Promise<Rule | null>;
    updateRule: (id: string, body: string) => Promise<void>;
    deleteRule: (id: string) => Promise<void>;
}

function sortByUpdatedDesc(rules: Rule[]): Rule[] {
    return [...rules].sort((a, b) => b.updatedAt - a.updatedAt);
}

export const useRulesStore = create<RulesState>((set, get) => ({
    rules: [],
    isLoading: false,
    isFetching: false,
    error: null,
    hasFetched: false,

    fetchRules: async () => {
        if (get().isFetching) return;
        set({ isFetching: true, isLoading: !get().hasFetched, error: null });

        try {
            const data = await api.get<Rule[]>("/rules");
            set({
                rules: sortByUpdatedDesc(data ?? []),
                isFetching: false,
                isLoading: false,
                hasFetched: true
            });
        } catch (error) {
            set({
                error: toApiErrorMessage(error, "Failed to load rules"),
                isFetching: false,
                isLoading: false,
                hasFetched: true
            });
        }
    },

    createRule: async (body = "") => {
        const previous = get().rules;
        // No optimistic insert: we don't know the server-assigned UUID yet.
        // The latency for a POST to the local sidecar is negligible.
        set({ error: null });

        try {
            const created = await api.post<Rule, { body: string }>("/rules", {
                body: { body }
            });
            set({ rules: sortByUpdatedDesc([created, ...previous]) });
            toast.success({
                title: "Rule added",
                description:
                    "It will be appended to every system prompt."
            });
            return created;
        } catch (error) {
            const message = toApiErrorMessage(error, "Failed to create rule");
            set({ error: message });
            toast.error({
                title: "Couldn't save rule",
                description: message
            });
            return null;
        }
    },

    updateRule: async (id, body) => {
        const previous = get().rules;
        const optimistic = previous.map((rule) =>
            rule.id === id
                ? { ...rule, body, updatedAt: Date.now() }
                : rule
        );
        set({ rules: sortByUpdatedDesc(optimistic), error: null });

        try {
            const updated = await api.put<Rule, { body: string }>(
                `/rules/${id}`,
                { body: { body } }
            );
            set({
                rules: sortByUpdatedDesc(
                    get().rules.map((rule) =>
                        rule.id === id ? updated : rule
                    )
                )
            });
            toast.success({ title: "Rule saved" });
        } catch (error) {
            const message = toApiErrorMessage(error, "Failed to save rule");
            set({ rules: previous, error: message });
            toast.error({
                title: "Couldn't save rule",
                description: message
            });
        }
    },

    deleteRule: async (id) => {
        const previous = get().rules;
        set({
            rules: previous.filter((rule) => rule.id !== id),
            error: null
        });

        try {
            await api.delete(`/rules/${id}`);
            toast.success({ title: "Rule deleted" });
        } catch (error) {
            const message = toApiErrorMessage(error, "Failed to delete rule");
            set({ rules: previous, error: message });
            toast.error({
                title: "Couldn't delete rule",
                description: message
            });
        }
    }
}));
