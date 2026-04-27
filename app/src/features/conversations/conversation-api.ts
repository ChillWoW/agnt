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
    mentions: MessageMention[] = [],
    useSkillNames: string[] = []
) {
    return api.post<ConversationWithMessages>(
        `/workspaces/${workspaceId}/conversations`,
        { body: { message, attachmentIds, mentions, useSkillNames } }
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
    mentions: MessageMention[] = [],
    useSkillNames: string[] = []
): Promise<Response> {
    return api.post<Response>(
        `/workspaces/${workspaceId}/conversations/${conversationId}/stream`,
        {
            body: { content, attachmentIds, mentions, useSkillNames },
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

/**
 * Ask the server to abort the conversation's in-flight stream. The server
 * fires its internal `AbortController`, which makes `streamText` emit a
 * final `abort` SSE event (with model id, generation duration, and
 * aggregated token usage) before the response stream closes. The client's
 * SSE reader then sees the event normally and exits the loop on `done`.
 *
 * Compared to dropping the local fetch, this preserves the duration +
 * cost in the assistant footer when the user hits Stop.
 *
 * Returns `{ stopped: true }` if a stream was running, `{ stopped: false }`
 * if there was nothing to abort.
 */
export function cancelStream(workspaceId: string, conversationId: string) {
    return api.post<{ success: boolean; stopped: boolean }>(
        `/workspaces/${workspaceId}/conversations/${conversationId}/stop`
    );
}

export function deleteConversation(workspaceId: string, conversationId: string) {
    return api.delete<{ success: boolean }>(
        `/workspaces/${workspaceId}/conversations/${conversationId}`
    );
}

export function archiveConversation(
    workspaceId: string,
    conversationId: string
) {
    return api.post<{ success: boolean; archived_at: string }>(
        `/workspaces/${workspaceId}/conversations/${conversationId}/archive`
    );
}

export function unarchiveConversation(
    workspaceId: string,
    conversationId: string
) {
    return api.post<{ success: boolean }>(
        `/workspaces/${workspaceId}/conversations/${conversationId}/unarchive`
    );
}

export function fetchArchivedConversations(workspaceId: string) {
    return api.get<{ conversations: Conversation[] }>(
        `/workspaces/${workspaceId}/conversations/archived`
    );
}

export function fetchSubagents(workspaceId: string, parentConversationId: string) {
    return api.get<{ subagents: Conversation[] }>(
        `/workspaces/${workspaceId}/conversations/${parentConversationId}/subagents`
    );
}

/**
 * Open a read-only SSE observer on an existing conversation. Returns the
 * raw Response; caller is responsible for consuming / releasing it.
 *
 * This does NOT trigger a new stream — it only replays live events the
 * conversation's primary streamer is already emitting through the server
 * broadcaster. Used by the subagent page to watch a subagent spawned by
 * its parent's `task` tool call.
 */
export function observeConversationEvents(
    workspaceId: string,
    conversationId: string,
    signal?: AbortSignal
): Promise<Response> {
    return api.get<Response>(
        `/workspaces/${workspaceId}/conversations/${conversationId}/events`,
        { parseAs: "response", signal }
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
