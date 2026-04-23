import { invoke } from "@tauri-apps/api/core";
import { useConversationStore } from "@/features/conversations";
import { usePermissionStore } from "@/features/permissions";
import { useQuestionStore } from "@/features/questions";

let lastSent = -1;
let scheduled = false;

function computeUnreadTotal(): number {
    const convStore = useConversationStore.getState();
    const permStore = usePermissionStore.getState();
    const qStore = useQuestionStore.getState();

    const unreadConversations = Object.keys(
        convStore.unreadConversationIds
    ).length;

    // Conversations with a pending permission or question also deserve a
    // badge even if they're the active conversation — the user still needs
    // to act. Dedupe with unread to avoid double-counting.
    const urgentConversationIds = new Set<string>();
    for (const [cid, queue] of Object.entries(
        permStore.pendingByConversationId
    )) {
        if (queue && queue.length > 0) urgentConversationIds.add(cid);
    }
    for (const [cid, queue] of Object.entries(
        qStore.pendingByConversationId
    )) {
        if (queue && queue.length > 0) urgentConversationIds.add(cid);
    }
    for (const cid of Object.keys(convStore.unreadConversationIds)) {
        urgentConversationIds.delete(cid);
    }

    return unreadConversations + urgentConversationIds.size;
}

function flush(): void {
    scheduled = false;
    const count = computeUnreadTotal();
    if (count === lastSent) return;
    lastSent = count;
    invoke("set_unread_badge", { count }).catch(() => {
        // Silently ignore — the command is a no-op on non-Windows platforms
        // and any transient failure will self-correct on the next update.
    });
}

function scheduleFlush(): void {
    if (scheduled) return;
    scheduled = true;
    // 50 ms debounce so a burst of SSE events produces one overlay update.
    setTimeout(flush, 50);
}

let initialized = false;

export function initUnreadBadge(): void {
    if (initialized) return;
    initialized = true;

    useConversationStore.subscribe((state, prev) => {
        if (state.unreadConversationIds !== prev.unreadConversationIds) {
            scheduleFlush();
        }
    });

    usePermissionStore.subscribe((state, prev) => {
        if (state.pendingByConversationId !== prev.pendingByConversationId) {
            scheduleFlush();
        }
    });

    useQuestionStore.subscribe((state, prev) => {
        if (state.pendingByConversationId !== prev.pendingByConversationId) {
            scheduleFlush();
        }
    });

    // Run once on init so a cold start with existing unreads (reload during
    // streaming) also paints the overlay.
    scheduleFlush();
}
