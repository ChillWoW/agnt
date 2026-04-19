import { api } from "@/lib/api";
import type { Todo } from "./types";

export function fetchTodos(workspaceId: string, conversationId: string) {
    return api.get<{ todos: Todo[] }>(
        `/workspaces/${workspaceId}/conversations/${conversationId}/todos`
    );
}
