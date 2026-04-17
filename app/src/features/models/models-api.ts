import { api } from "@/lib/api";
import type { ModelCatalogEntry } from "./types";

let modelsCache: ModelCatalogEntry[] | null = null;
let modelsRequest: Promise<ModelCatalogEntry[]> | null = null;

export function fetchModels() {
    if (modelsCache) {
        return Promise.resolve(modelsCache);
    }

    if (modelsRequest) {
        return modelsRequest;
    }

    modelsRequest = api
        .get<ModelCatalogEntry[]>("/models")
        .then((models) => {
            modelsCache = models;
            return models;
        })
        .finally(() => {
            modelsRequest = null;
        });

    return modelsRequest;
}

export function getCachedModels() {
    return modelsCache;
}
