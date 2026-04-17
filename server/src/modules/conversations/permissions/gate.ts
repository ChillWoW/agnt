import { logger } from "../../../lib/logger";

export type PermissionDecision = "allow_once" | "allow_session" | "deny";

export interface PermissionRequestInit {
    conversationId: string;
    toolName: string;
    input: unknown;
}

export interface PermissionRequest extends PermissionRequestInit {
    id: string;
    createdAt: string;
}

interface PendingPermission {
    request: PermissionRequest;
    resolve: (decision: PermissionDecision) => void;
    reject: (reason: Error) => void;
}

const pendingById = new Map<string, PendingPermission>();
const pendingByConversation = new Map<string, Set<string>>();
const sessionAllowByConversation = new Map<string, Set<string>>();

type PermissionListener = (event: PermissionGateEvent) => void;

export type PermissionGateEvent =
    | { type: "requested"; request: PermissionRequest }
    | { type: "resolved"; requestId: string; decision: PermissionDecision };

const listenersByConversation = new Map<string, Set<PermissionListener>>();

function notify(conversationId: string, event: PermissionGateEvent): void {
    const listeners = listenersByConversation.get(conversationId);
    if (!listeners) return;
    for (const listener of listeners) {
        try {
            listener(event);
        } catch (error) {
            logger.error("[permissions] listener threw", error);
        }
    }
}

export function subscribeToPermissions(
    conversationId: string,
    listener: PermissionListener
): () => void {
    const set = listenersByConversation.get(conversationId) ?? new Set();
    set.add(listener);
    listenersByConversation.set(conversationId, set);

    return () => {
        const current = listenersByConversation.get(conversationId);
        if (!current) return;
        current.delete(listener);
        if (current.size === 0) {
            listenersByConversation.delete(conversationId);
        }
    };
}

export function requestPermission(
    init: PermissionRequestInit
): Promise<PermissionDecision> {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const request: PermissionRequest = { ...init, id, createdAt };

    return new Promise<PermissionDecision>((resolve, reject) => {
        pendingById.set(id, { request, resolve, reject });

        const perConversation =
            pendingByConversation.get(init.conversationId) ?? new Set();
        perConversation.add(id);
        pendingByConversation.set(init.conversationId, perConversation);

        notify(init.conversationId, { type: "requested", request });
    });
}

export function resolvePermission(
    requestId: string,
    decision: PermissionDecision
): { ok: true } | { ok: false; error: string } {
    const pending = pendingById.get(requestId);
    if (!pending) {
        return { ok: false, error: `Permission request not found: ${requestId}` };
    }

    pendingById.delete(requestId);
    const perConversation = pendingByConversation.get(
        pending.request.conversationId
    );
    perConversation?.delete(requestId);
    if (perConversation && perConversation.size === 0) {
        pendingByConversation.delete(pending.request.conversationId);
    }

    if (decision === "allow_session") {
        rememberSessionAllow(
            pending.request.conversationId,
            pending.request.toolName
        );
    }

    pending.resolve(decision);
    notify(pending.request.conversationId, {
        type: "resolved",
        requestId,
        decision
    });

    return { ok: true };
}

export function abortPermissions(
    conversationId: string,
    reason = "aborted"
): void {
    const ids = pendingByConversation.get(conversationId);
    if (!ids) return;

    for (const id of ids) {
        const pending = pendingById.get(id);
        if (!pending) continue;
        pendingById.delete(id);
        pending.reject(new Error(reason));
        notify(conversationId, {
            type: "resolved",
            requestId: id,
            decision: "deny"
        });
    }

    pendingByConversation.delete(conversationId);
}

export function rememberSessionAllow(
    conversationId: string,
    toolName: string
): void {
    const set = sessionAllowByConversation.get(conversationId) ?? new Set();
    set.add(toolName);
    sessionAllowByConversation.set(conversationId, set);
}

export function isSessionAllowed(
    conversationId: string,
    toolName: string
): boolean {
    return (
        sessionAllowByConversation.get(conversationId)?.has(toolName) ?? false
    );
}

export function clearSessionAllow(conversationId: string): void {
    sessionAllowByConversation.delete(conversationId);
}

export function clearConversationPermissionState(
    conversationId: string
): void {
    abortPermissions(conversationId, "conversation-cleared");
    clearSessionAllow(conversationId);
    listenersByConversation.delete(conversationId);
}
