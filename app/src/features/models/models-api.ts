import { api } from "@/lib/api";
import type { ModelCatalogEntry } from "./types";

export function fetchModels() {
    return api.get<ModelCatalogEntry[]>("/models");
}
