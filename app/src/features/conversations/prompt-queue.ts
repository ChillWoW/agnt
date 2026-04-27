import { create } from "zustand";
import type { MessageMention } from "./conversation-api";

/**
 * A prompt the user typed and submitted while a previous turn was still
 * generating. Buffered client-side until the in-flight stream's `finally`
 * fires, then auto-replayed (FIFO) through `useConversationStore.sendMessage`.
 *
 * Carries the same payload `sendMessage` accepts — including attachment ids,
 * mentions, and slash-command skill names — so a queued prompt is
 * indistinguishable from a freshly-sent one once it drains.
 */
export interface QueuedPrompt {
    id: string;
    content: string;
    attachmentIds: string[];
    mentions: MessageMention[];
    useSkillNames?: string[];
    enqueuedAt: string;
}

export type QueuedPromptInput = Omit<QueuedPrompt, "id" | "enqueuedAt">;

interface PromptQueueState {
    queueByConversationId: Record<string, QueuedPrompt[]>;
    enqueue: (conversationId: string, prompt: QueuedPromptInput) => QueuedPrompt;
    remove: (conversationId: string, queuedId: string) => void;
    clear: (conversationId: string) => void;
    /** Pop the head of the queue. Returns `undefined` when empty. */
    shift: (conversationId: string) => QueuedPrompt | undefined;
}

function omitKey<V>(
    record: Record<string, V>,
    key: string
): Record<string, V> {
    if (!(key in record)) return record;
    const { [key]: _removed, ...rest } = record;
    return rest;
}

export const usePromptQueueStore = create<PromptQueueState>()((set, get) => ({
    queueByConversationId: {},

    enqueue: (conversationId, prompt) => {
        const entry: QueuedPrompt = {
            id: crypto.randomUUID(),
            content: prompt.content,
            attachmentIds: prompt.attachmentIds,
            mentions: prompt.mentions,
            useSkillNames: prompt.useSkillNames,
            enqueuedAt: new Date().toISOString()
        };
        set((state) => {
            const existing = state.queueByConversationId[conversationId] ?? [];
            return {
                queueByConversationId: {
                    ...state.queueByConversationId,
                    [conversationId]: [...existing, entry]
                }
            };
        });
        return entry;
    },

    remove: (conversationId, queuedId) => {
        set((state) => {
            const existing = state.queueByConversationId[conversationId];
            if (!existing || existing.length === 0) return {};
            const next = existing.filter((p) => p.id !== queuedId);
            if (next.length === existing.length) return {};
            if (next.length === 0) {
                return {
                    queueByConversationId: omitKey(
                        state.queueByConversationId,
                        conversationId
                    )
                };
            }
            return {
                queueByConversationId: {
                    ...state.queueByConversationId,
                    [conversationId]: next
                }
            };
        });
    },

    clear: (conversationId) => {
        set((state) => {
            if (!(conversationId in state.queueByConversationId)) return {};
            return {
                queueByConversationId: omitKey(
                    state.queueByConversationId,
                    conversationId
                )
            };
        });
    },

    shift: (conversationId) => {
        const existing = get().queueByConversationId[conversationId];
        if (!existing || existing.length === 0) return undefined;
        const [head, ...rest] = existing;
        set((state) => ({
            queueByConversationId:
                rest.length === 0
                    ? omitKey(state.queueByConversationId, conversationId)
                    : {
                          ...state.queueByConversationId,
                          [conversationId]: rest
                      }
        }));
        return head;
    }
}));
