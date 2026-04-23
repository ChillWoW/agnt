import { EventEmitter } from "node:events";
import type { SseStreamController } from "./conversation.sse";

/**
 * Per-conversation SSE-event broadcaster.
 *
 * The primary HTTP stream (POST /stream or /reply) owns its own
 * SseStreamController and uses it to feed its caller. But we also want a
 * SECOND viewer (e.g. the subagent page observing a stream it didn't start,
 * or the parent observing a subagent it spawned) to get the same live
 * events.
 *
 * The solution: wrap the primary controller with
 * `wrapControllerWithBroadcast(controller, conversationId)`. Every SSE text
 * line enqueued is both sent to the primary and fanned out through a
 * per-conversation-id EventEmitter. Observers subscribed via
 * `subscribeToConversationSse(conversationId, cb)` receive the same lines
 * and can forward them to their own HTTP response.
 *
 * This keeps the stream code's call sites unchanged — they just
 * `controller.enqueue(sseEvent(...))` as before. Broadcasting is a
 * transparent pass-through.
 */

type Listener = (line: string) => void;

const emitter = new EventEmitter();
emitter.setMaxListeners(0);

function channelFor(conversationId: string): string {
    return `sse:${conversationId}`;
}

export function wrapControllerWithBroadcast(
    controller: SseStreamController,
    conversationId: string
): SseStreamController {
    const channel = channelFor(conversationId);
    return {
        enqueue(text: string) {
            controller.enqueue(text);
            emitter.emit(channel, text);
        },
        close() {
            controller.close();
        }
    };
}

export function publishConversationSseLine(
    conversationId: string,
    line: string
): void {
    emitter.emit(channelFor(conversationId), line);
}

export function subscribeToConversationSse(
    conversationId: string,
    listener: Listener
): () => void {
    const channel = channelFor(conversationId);
    emitter.on(channel, listener);
    return () => emitter.off(channel, listener);
}
