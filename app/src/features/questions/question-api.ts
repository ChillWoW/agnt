import { api } from "@/lib/api";

export function respondToQuestions(
    workspaceId: string,
    conversationId: string,
    requestId: string,
    answers: string[][]
) {
    return api.post<{ success: boolean }>(
        `/workspaces/${workspaceId}/conversations/${conversationId}/questions/${requestId}/respond`,
        { body: { answers } }
    );
}

export function cancelQuestionsRequest(
    workspaceId: string,
    conversationId: string,
    requestId: string
) {
    return api.post<{ success: boolean }>(
        `/workspaces/${workspaceId}/conversations/${conversationId}/questions/${requestId}/respond`,
        { body: { cancelled: true } }
    );
}
