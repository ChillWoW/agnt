import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { useRulesStore } from "./store";

export function useRules() {
    const {
        rules,
        isLoading,
        error,
        hasFetched,
        fetchRules,
        createRule,
        updateRule,
        deleteRule
    } = useRulesStore(
        useShallow((s) => ({
            rules: s.rules,
            isLoading: s.isLoading,
            error: s.error,
            hasFetched: s.hasFetched,
            fetchRules: s.fetchRules,
            createRule: s.createRule,
            updateRule: s.updateRule,
            deleteRule: s.deleteRule
        }))
    );

    useEffect(() => {
        if (!hasFetched) {
            void fetchRules();
        }
    }, [hasFetched, fetchRules]);

    return {
        rules,
        isLoading,
        error,
        createRule,
        updateRule,
        deleteRule
    };
}
