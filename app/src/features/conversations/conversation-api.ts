import { api } from "@/lib/api";
import type { Conversation, ConversationWithMessages, Message, MessageRole } from "./conversation-types";

export interface MessageMention {
    path: string;
    type: "file" | "directory";
}

export function fetchConversations(workspaceId: string) {
    return api.get<Conversation[]>(`/workspaces/${workspaceId}/conversations`);
}

export function fetchConversation(workspaceId: string, conversationId: string) {
    return api.get<ConversationWithMessages>(
        `/workspaces/${workspaceId}/conversations/${conversationId}`
    );
}

export function createConversation(
    workspaceId: string,
    message: string,
    attachmentIds: string[] = [],
    mentions: MessageMention[] = []
) {
    return api.post<ConversationWithMessages>(
        `/workspaces/${workspaceId}/conversations`,
        { body: { message, attachmentIds, mentions } }
    );
}

export function addMessage(
    workspaceId: string,
    conversationId: string,
    role: MessageRole,
    content: string
) {
    return api.post<Message>(
        `/workspaces/${workspaceId}/conversations/${conversationId}/messages`,
        { body: { role, content } }
    );
}

export function streamMessage(
    workspaceId: string,
    conversationId: string,
    content: string,
    signal?: AbortSignal,
    attachmentIds: string[] = [],
    mentions: MessageMention[] = []
): Promise<Response> {
    return api.post<Response>(
        `/workspaces/${workspaceId}/conversations/${conversationId}/stream`,
        {
            body: { content, attachmentIds, mentions },
            parseAs: "response",
            signal
        }
    );
}

export function replyToConversation(
    workspaceId: string,
    conversationId: string,
    signal?: AbortSignal
): Promise<Response> {
    return api.post<Response>(
        `/workspaces/${workspaceId}/conversations/${conversationId}/reply`,
        { parseAs: "response", signal }
    );
}

export function deleteConversation(workspaceId: string, conversationId: string) {
    return api.delete<{ success: boolean }>(
        `/workspaces/${workspaceId}/conversations/${conversationId}`
    );
}

export function updateConversationTitle(
    workspaceId: string,
    conversationId: string,
    title: string
) {
    return api.patch<Conversation>(
        `/workspaces/${workspaceId}/conversations/${conversationId}`,
        { body: { title } }
    );
}
