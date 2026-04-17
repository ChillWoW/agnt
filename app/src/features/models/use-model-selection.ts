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
    const [isLoading, setIsLoading] = useState(() => getCachedModels() == null);

    useEffect(() => {
        let cancelled = false;
        const cachedModels = getCachedModels();

        if (cachedModels) {
            setModels(cachedModels);
            setSelection((current) => normalizeSelection(cachedModels, current));
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

    const selectedModel = useMemo(
        () => models.find((model) => model.id === selection.modelId) ?? null,
        [models, selection.modelId]
    );

    const selectedReasoningEfforts = selectedModel?.allowedEfforts ?? [];

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

    return {
        isLoading,
        models,
        selection,
        selectedModel,
        selectedReasoningEfforts,
        cycleReasoningEffort,
        selectModel,
        selectSpeed,
        selectReasoningEffort
    };
}
