/**
 * Bridge between `conversation.stream.ts` (which owns the tool_invocations
 * row + message identifiers) and a tool's `execute()` function (which only
 * sees the AI SDK's `toolCallId`).
 *
 * The stream layer registers the mapping at `tool-input-start` so shell
 * tools can translate the SDK-level id back into our invocation id and
 * associated conversation/workspace/message identifiers. Entries self-evict
 * after a long delay as a safety net against leaks.
 */

const EVICTION_MS = 10 * 60 * 1000;

export interface ToolInvocationContext {
    invocationId: string;
    conversationId: string;
    workspaceId: string;
    messageId: string;
}

interface Entry extends ToolInvocationContext {
    timer: ReturnType<typeof setTimeout>;
}

const byToolCallId = new Map<string, Entry>();

export function registerToolInvocationContext(
    toolCallId: string,
    ctx: ToolInvocationContext
): void {
    const existing = byToolCallId.get(toolCallId);
    if (existing) clearTimeout(existing.timer);
    const timer = setTimeout(() => {
        byToolCallId.delete(toolCallId);
    }, EVICTION_MS);
    if (typeof timer === "object" && timer && "unref" in timer) {
        try {
            (timer as { unref?: () => void }).unref?.();
        } catch {
            // ignore
        }
    }
    byToolCallId.set(toolCallId, { ...ctx, timer });
}

export function resolveToolInvocationContext(
    toolCallId: string | undefined
): ToolInvocationContext | null {
    if (!toolCallId) return null;
    const entry = byToolCallId.get(toolCallId);
    if (!entry) return null;
    return {
        invocationId: entry.invocationId,
        conversationId: entry.conversationId,
        workspaceId: entry.workspaceId,
        messageId: entry.messageId
    };
}

export function unregisterToolInvocationContext(toolCallId: string): void {
    const entry = byToolCallId.get(toolCallId);
    if (!entry) return;
    clearTimeout(entry.timer);
    byToolCallId.delete(toolCallId);
}
