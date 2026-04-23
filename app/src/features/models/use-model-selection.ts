import { useCallback, useEffect, useMemo, useState } from "react";
import {
    fetchEffectiveConversationState,
    fetchWorkspaceState,
    updateConversationState,
    updateWorkspaceState
} from "@/features/history";
import { fetchModels, getCachedModels } from "./models-api";
import type {
    ModelCatalogEntry,
    ModelSelection,
    ModelSpeed,
    ReasoningEffort
} from "./types";

type ModelSelectionScope = {
    workspaceId?: string | null;
    conversationId?: string | null;
};

function isReasoningEffort(value: unknown): value is ReasoningEffort {
    return (
        value === "none" ||
        value === "minimal" ||
        value === "low" ||
        value === "medium" ||
        value === "high" ||
        value === "xhigh"
    );
}

function getStoredReasoningEffort(
    values: Record<string, unknown>
): ReasoningEffort | null {
    if (Object.prototype.hasOwnProperty.call(values, "reasoningEffort")) {
        return isReasoningEffort(values.reasoningEffort)
            ? values.reasoningEffort
            : null;
    }

    return isReasoningEffort(values.effort) ? values.effort : null;
}

function getDefaultSelection(models: ModelCatalogEntry[]): ModelSelection {
    const preferredModel =
        models.find((model) => model.status === "recommended") ?? models[0] ?? null;

    return {
        modelId: preferredModel?.id ?? null,
        reasoningEffort: preferredModel?.defaultEffort ?? null,
        speed: "standard"
    };
}

// Keep in sync with `DEFAULT_SUBAGENT_MODEL` +
// `DEFAULT_SUBAGENT_REASONING_EFFORT` on the server (conversation.stream.ts).
// These are only used as the UI's fallback when no per-scope override has
// been persisted yet; the server also falls back to these, so the two sides
// agree even when the keys are missing.
export const DEFAULT_SUBAGENT_MODEL_ID = "gpt-5.4-mini";
export const DEFAULT_SUBAGENT_REASONING_EFFORT: ReasoningEffort = "high";

export type SubagentSelection = {
    modelId: string | null;
    reasoningEffort: ReasoningEffort | null;
};

function getDefaultSubagentSelection(
    models: ModelCatalogEntry[]
): SubagentSelection {
    const preferred =
        models.find((m) => m.id === DEFAULT_SUBAGENT_MODEL_ID) ?? null;
    return {
        modelId: preferred?.id ?? null,
        reasoningEffort: preferred?.allowedEfforts.includes(
            DEFAULT_SUBAGENT_REASONING_EFFORT
        )
            ? DEFAULT_SUBAGENT_REASONING_EFFORT
            : (preferred?.defaultEffort ?? null)
    };
}

function normalizeSubagentSelection(
    models: ModelCatalogEntry[],
    raw: Partial<SubagentSelection>
): SubagentSelection {
    const fallback = getDefaultSubagentSelection(models);
    const model = models.find((entry) => entry.id === raw.modelId) ?? null;

    if (!model) {
        return fallback;
    }

    const reasoningEffort =
        isReasoningEffort(raw.reasoningEffort) &&
        model.supportsReasoningEffort &&
        model.allowedEfforts.includes(raw.reasoningEffort)
            ? raw.reasoningEffort
            : model.allowedEfforts.includes(DEFAULT_SUBAGENT_REASONING_EFFORT)
              ? DEFAULT_SUBAGENT_REASONING_EFFORT
              : model.defaultEffort;

    return {
        modelId: model.id,
        reasoningEffort
    };
}

function toSubagentSelection(
    models: ModelCatalogEntry[],
    values: Record<string, unknown>
): SubagentSelection {
    const rawModelId =
        typeof values.subagentModel === "string" ? values.subagentModel : null;
    const rawEffort = values.subagentReasoningEffort;
    return normalizeSubagentSelection(models, {
        modelId: rawModelId,
        reasoningEffort: isReasoningEffort(rawEffort) ? rawEffort : null
    });
}

function normalizeSelection(
    models: ModelCatalogEntry[],
    raw: Partial<ModelSelection>
): ModelSelection {
    const fallback = getDefaultSelection(models);
    const model = models.find((entry) => entry.id === raw.modelId) ?? null;

    if (!model) {
        return fallback;
    }

    const reasoningEffort =
        isReasoningEffort(raw.reasoningEffort) &&
        model.supportsReasoningEffort &&
        model.allowedEfforts.includes(raw.reasoningEffort)
            ? raw.reasoningEffort
            : model.defaultEffort;

    return {
        modelId: model.id,
        reasoningEffort,
        speed:
            raw.speed === "fast" && model.supportsFastMode ? "fast" : "standard"
    };
}

function toSelection(
    models: ModelCatalogEntry[],
    values: Record<string, unknown>
): ModelSelection {
    return normalizeSelection(models, {
        modelId:
            typeof values.activeModel === "string"
                ? values.activeModel
                : typeof values.model === "string"
                  ? values.model
                  : null,
        reasoningEffort: getStoredReasoningEffort(values),
        speed: values.fastMode === true ? "fast" : "standard"
    });
}

export function useModelSelection({
    workspaceId,
    conversationId
}: ModelSelectionScope) {
    const [models, setModels] = useState<ModelCatalogEntry[]>(
        () => getCachedModels() ?? []
    );
    const [selection, setSelection] = useState<ModelSelection>({
        modelId: null,
        reasoningEffort: null,
        speed: "standard"
    });
    const [subagentSelection, setSubagentSelection] =
        useState<SubagentSelection>(() => getDefaultSubagentSelection([]));
    const [isLoading, setIsLoading] = useState(() => getCachedModels() == null);

    useEffect(() => {
        let cancelled = false;
        const cachedModels = getCachedModels();

        if (cachedModels) {
            setModels(cachedModels);
            setSelection((current) => normalizeSelection(cachedModels, current));
            setSubagentSelection((current) =>
                normalizeSubagentSelection(cachedModels, current)
            );
            setIsLoading(false);
            return;
        }

        async function loadModels() {
            setIsLoading(true);

            try {
                const nextModels = await fetchModels();
                if (cancelled) {
                    return;
                }

                setModels(nextModels);
                setSelection((current) => normalizeSelection(nextModels, current));
                setSubagentSelection((current) =>
                    normalizeSubagentSelection(nextModels, current)
                );
            } finally {
                if (!cancelled) {
                    setIsLoading(false);
                }
            }
        }

        void loadModels();

        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        if (!workspaceId || models.length === 0) {
            return;
        }

        const nextWorkspaceId = workspaceId;
        let cancelled = false;

        async function loadSelection() {
            const values = conversationId
                ? (await fetchEffectiveConversationState(nextWorkspaceId, conversationId)).merged
                : (await fetchWorkspaceState(nextWorkspaceId)).values;

            if (cancelled) {
                return;
            }

            setSelection(toSelection(models, values));
            setSubagentSelection(toSubagentSelection(models, values));
        }

        void loadSelection();

        return () => {
            cancelled = true;
        };
    }, [workspaceId, conversationId, models]);

    const persistSelection = useCallback(
        async (nextSelection: ModelSelection) => {
            if (!workspaceId) {
                return;
            }

            const nextWorkspaceId = workspaceId;
            const payload = {
                values: {
                    activeModel: nextSelection.modelId,
                    reasoningEffort: nextSelection.reasoningEffort,
                    fastMode: nextSelection.speed === "fast"
                },
                source: "chat-model-selector"
            };

            if (conversationId) {
                await updateConversationState(nextWorkspaceId, conversationId, payload);
                return;
            }

            await updateWorkspaceState(nextWorkspaceId, payload);
        },
        [workspaceId, conversationId]
    );

    const applySelection = useCallback(
        (nextSelection: ModelSelection) => {
            const normalized = normalizeSelection(models, nextSelection);
            setSelection(normalized);
            void persistSelection(normalized);
        },
        [models, persistSelection]
    );

    const persistSubagentSelection = useCallback(
        async (nextSelection: SubagentSelection) => {
            if (!workspaceId) {
                return;
            }

            const nextWorkspaceId = workspaceId;
            // Subagent defaults live on the *parent* conversation (the
            // conversation spawning the subagent). Scope writes mirror the
            // primary model selector: conversation-scoped when a
            // conversationId is provided, workspace-wide otherwise.
            const payload = {
                values: {
                    subagentModel: nextSelection.modelId,
                    subagentReasoningEffort: nextSelection.reasoningEffort
                },
                source: "chat-model-selector.subagent"
            };

            if (conversationId) {
                await updateConversationState(
                    nextWorkspaceId,
                    conversationId,
                    payload
                );
                return;
            }

            await updateWorkspaceState(nextWorkspaceId, payload);
        },
        [workspaceId, conversationId]
    );

    const applySubagentSelection = useCallback(
        (nextSelection: SubagentSelection) => {
            const normalized = normalizeSubagentSelection(models, nextSelection);
            setSubagentSelection(normalized);
            void persistSubagentSelection(normalized);
        },
        [models, persistSubagentSelection]
    );

    const selectedModel = useMemo(
        () => models.find((model) => model.id === selection.modelId) ?? null,
        [models, selection.modelId]
    );

    const selectedReasoningEfforts = selectedModel?.allowedEfforts ?? [];

    const selectedSubagentModel = useMemo(
        () =>
            models.find((model) => model.id === subagentSelection.modelId) ??
            null,
        [models, subagentSelection.modelId]
    );

    const selectedSubagentReasoningEfforts =
        selectedSubagentModel?.allowedEfforts ?? [];

    const cycleReasoningEffort = useCallback(() => {
        if (!selectedModel || selectedReasoningEfforts.length === 0) {
            return;
        }

        const currentIndex = selectedReasoningEfforts.indexOf(
            selection.reasoningEffort ?? selectedModel.defaultEffort ?? selectedReasoningEfforts[0]
        );
        const nextIndex = (currentIndex + 1) % selectedReasoningEfforts.length;

        applySelection({
            ...selection,
            reasoningEffort: selectedReasoningEfforts[nextIndex]
        });
    }, [applySelection, selectedModel, selectedReasoningEfforts, selection]);

    const selectReasoningEffort = useCallback(
        (effort: ReasoningEffort) => {
            applySelection({ ...selection, reasoningEffort: effort });
        },
        [applySelection, selection]
    );

    const selectModel = useCallback(
        (modelId: string) => {
            applySelection({
                ...selection,
                modelId,
                reasoningEffort: null,
                speed: "standard"
            });
        },
        [applySelection, selection]
    );

    const selectSpeed = useCallback(
        (speed: ModelSpeed) => {
            applySelection({ ...selection, speed });
        },
        [applySelection, selection]
    );

    const selectSubagentModel = useCallback(
        (modelId: string) => {
            applySubagentSelection({
                modelId,
                reasoningEffort: null
            });
        },
        [applySubagentSelection]
    );

    const selectSubagentReasoningEffort = useCallback(
        (effort: ReasoningEffort) => {
            applySubagentSelection({
                ...subagentSelection,
                reasoningEffort: effort
            });
        },
        [applySubagentSelection, subagentSelection]
    );

    return {
        isLoading,
        models,
        selection,
        selectedModel,
        selectedReasoningEfforts,
        cycleReasoningEffort,
        selectModel,
        selectSpeed,
        selectReasoningEffort,
        subagentSelection,
        selectedSubagentModel,
        selectedSubagentReasoningEfforts,
        selectSubagentModel,
        selectSubagentReasoningEffort
    };
}
