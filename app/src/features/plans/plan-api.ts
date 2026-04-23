import { api } from "@/lib/api";
import type { Plan } from "./plan-types";
import type { Todo } from "@/features/todos";

export function fetchPlan(workspaceId: string, conversationId: string) {
    return api.get<{ plan: Plan }>(
        `/workspaces/${workspaceId}/conversations/${conversationId}/plan`
    );
}

export function deletePlan(workspaceId: string, conversationId: string) {
    return api.delete<{ success: boolean }>(
        `/workspaces/${workspaceId}/conversations/${conversationId}/plan`
    );
}

export function buildFromPlan(workspaceId: string, conversationId: string) {
    return api.post<{ success: boolean; todos: Todo[]; agenticMode: string }>(
        `/workspaces/${workspaceId}/conversations/${conversationId}/plan/build`
    );
}
