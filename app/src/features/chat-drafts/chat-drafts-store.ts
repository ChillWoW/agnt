import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type DraftSlot =
    | { kind: "home"; workspaceId: string }
    | { kind: "conversation"; conversationId: string };

export interface DraftSnapshot {
    docJSON: unknown;
    plainText: string;
    updatedAt: string;
}

interface ChatDraftsState {
    homeByWorkspace: Record<string, DraftSnapshot>;
    byConversation: Record<string, DraftSnapshot>;

    getDraft: (slot: DraftSlot) => DraftSnapshot | undefined;
    setDraft: (slot: DraftSlot, snapshot: DraftSnapshot) => void;
    clearDraft: (slot: DraftSlot) => void;
}

// JSON-stringified payloads above this size are skipped entirely. Drafts are
// meant for short composition state, not pasted novels — going past this bound
// almost certainly means something pathological happened (giant paste, runaway
// loop). We log + drop instead of letting localStorage silently fail.
const DRAFT_DOC_MAX_BYTES = 64 * 1024;

function isSnapshotEffectivelyEmpty(snapshot: DraftSnapshot): boolean {
    if (snapshot.plainText.trim().length > 0) return false;
    const doc = snapshot.docJSON as
        | { content?: ReadonlyArray<unknown> }
        | null
        | undefined;
    if (!doc || !Array.isArray(doc.content)) return true;
    // The Tiptap doc could be a single empty paragraph but still contain
    // a mention chip with no surrounding text — treat that as non-empty.
    const stack: unknown[] = [...doc.content];
    while (stack.length > 0) {
        const node = stack.pop() as
            | { type?: string; content?: ReadonlyArray<unknown> }
            | null
            | undefined;
        if (!node) continue;
        if (node.type === "mention") return false;
        if (Array.isArray(node.content)) {
            stack.push(...node.content);
        }
    }
    return true;
}

export const useChatDraftsStore = create<ChatDraftsState>()(
    persist(
        (set, get) => ({
            homeByWorkspace: {},
            byConversation: {},

            getDraft: (slot) => {
                const state = get();
                if (slot.kind === "home") {
                    return state.homeByWorkspace[slot.workspaceId];
                }
                return state.byConversation[slot.conversationId];
            },

            setDraft: (slot, snapshot) => {
                if (isSnapshotEffectivelyEmpty(snapshot)) {
                    get().clearDraft(slot);
                    return;
                }
                let serializedSize = 0;
                try {
                    serializedSize = JSON.stringify(snapshot.docJSON).length;
                } catch {
                    serializedSize = Number.POSITIVE_INFINITY;
                }
                if (serializedSize > DRAFT_DOC_MAX_BYTES) {
                    console.warn(
                        `[chat-drafts] dropping draft (${serializedSize} bytes > ${DRAFT_DOC_MAX_BYTES})`
                    );
                    get().clearDraft(slot);
                    return;
                }
                set((s) => {
                    if (slot.kind === "home") {
                        return {
                            homeByWorkspace: {
                                ...s.homeByWorkspace,
                                [slot.workspaceId]: snapshot
                            }
                        };
                    }
                    return {
                        byConversation: {
                            ...s.byConversation,
                            [slot.conversationId]: snapshot
                        }
                    };
                });
            },

            clearDraft: (slot) => {
                set((s) => {
                    if (slot.kind === "home") {
                        if (!(slot.workspaceId in s.homeByWorkspace)) return s;
                        const next = { ...s.homeByWorkspace };
                        delete next[slot.workspaceId];
                        return { homeByWorkspace: next };
                    }
                    if (!(slot.conversationId in s.byConversation)) return s;
                    const next = { ...s.byConversation };
                    delete next[slot.conversationId];
                    return { byConversation: next };
                });
            }
        }),
        {
            name: "chat-input-drafts",
            storage: createJSONStorage(() => localStorage),
            partialize: (state) => ({
                homeByWorkspace: state.homeByWorkspace,
                byConversation: state.byConversation
            })
        }
    )
);

export function getDraft(slot: DraftSlot): DraftSnapshot | undefined {
    return useChatDraftsStore.getState().getDraft(slot);
}

export function setDraft(slot: DraftSlot, snapshot: DraftSnapshot): void {
    useChatDraftsStore.getState().setDraft(slot, snapshot);
}

export function clearDraft(slot: DraftSlot): void {
    useChatDraftsStore.getState().clearDraft(slot);
}

export function draftSlotKey(slot: DraftSlot): string {
    return slot.kind === "home"
        ? `home:${slot.workspaceId}`
        : `convo:${slot.conversationId}`;
}
