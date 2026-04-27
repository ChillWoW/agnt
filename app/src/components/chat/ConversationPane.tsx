import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import {
    ArrowDownIcon,
    CaretRightIcon,
    FolderNotchIcon,
    XIcon
} from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { Popover, PopoverContent, PopoverTrigger, Tooltip } from "@/components/ui";
import { ChatInput } from "@/components/chat/ChatInput";
import { MessageList } from "@/components/chat/MessageList";
import {
    useConversationStore,
    usePromptQueueStore
} from "@/features/conversations";
import type { SubagentType, Message } from "@/features/conversations";
import { useWorkspaceStore } from "@/features/workspaces";
import {
    bumpRestoreEpoch,
    setDraft,
    type DraftSlot,
    type DraftSnapshot
} from "@/features/chat-drafts";

/**
 * Build a Tiptap-compatible draft snapshot from a plain-text user prompt.
 * Used by the early-stop UX to push a discarded user message back into
 * the chat input without mention metadata (the in-memory user row only
 * carries the rendered plain text — mention nodes are server-side only
 * by the time the message is dispatched). Returns `null` for an empty
 * string so the caller can avoid writing a no-op draft.
 */
function buildPlainTextDraft(content: string): DraftSnapshot | null {
    if (content.length === 0) return null;
    return {
        docJSON: {
            type: "doc",
            content: [
                {
                    type: "paragraph",
                    content: [{ type: "text", text: content }]
                }
            ]
        },
        plainText: content,
        updatedAt: new Date().toISOString()
    };
}

/**
 * Decide whether the in-flight assistant turn is still in the
 * "Planning next moves" placeholder state — i.e. the model has not
 * emitted any reasoning, tool call, or text delta yet. Mirrors the
 * `showStreamingPlaceholder` check in `MessageBubble` so a Stop press
 * during that window can be promoted to an early-stop discard.
 */
function isAssistantPlaceholderTurn(message: Message | undefined): boolean {
    if (!message) return false;
    if (message.role !== "assistant") return false;
    if (!message.isStreaming) return false;
    if (message.content.length > 0) return false;
    if ((message.tool_invocations?.length ?? 0) > 0) return false;
    if ((message.reasoning?.length ?? 0) > 0) return false;
    if (
        message.reasoning_parts?.some((part) => part.text.length > 0) ?? false
    ) {
        return false;
    }
    return true;
}

const SUBAGENT_TYPE_LABEL: Record<SubagentType, string> = {
    generalPurpose: "generalPurpose",
    explore: "explore",
    shell: "shell",
    docs: "docs",
    "best-of-n-runner": "best-of-n-runner"
};

export interface ConversationPaneProps {
    /** Conversation rendered inside the pane. */
    conversationId: string;
    /**
     * The primary pane is URL-bound; secondary panes live in
     * `useSplitPaneStore`. Pass `true` for the route-rendered pane and
     * `false` for every additional pane in the split layout.
     */
    isPrimary?: boolean;
    /** Whether this pane currently has the keyboard/UI focus marker. */
    isFocused?: boolean;
    /** Whether any split panes are currently visible at all (>1 pane). */
    splitActive?: boolean;
    /** Called when the user clicks anywhere inside the pane chrome. */
    onFocus?: () => void;
    /** Called when the user clicks the secondary-pane close button. */
    onClose?: () => void;
}

/**
 * Self-contained chat pane: own conversation hydration, breadcrumbs,
 * message list, scroll-to-bottom button, and chat input. Used by both the
 * `/conversations/$conversationId` route (as the primary pane) and the
 * split-pane layout (as secondary panes).
 *
 * State is keyed by `conversationId` rather than by pane id, so the same
 * Zustand slices that power the rest of the app (streaming, permissions,
 * questions, drafts) keep working unchanged when a conversation is shown
 * inside a secondary pane.
 */
export function ConversationPane({
    conversationId,
    isPrimary = false,
    isFocused = false,
    splitActive = false,
    onFocus,
    onClose
}: ConversationPaneProps) {
    const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
    const activeWorkspace = useWorkspaceStore(
        (s) =>
            s.workspaces.find(
                (workspace) => workspace.id === activeWorkspaceId
            ) ?? null
    );

    const conversation = useConversationStore(
        (s) => s.conversationsById[conversationId] ?? null
    );
    const isLoadingConversation = useConversationStore((s) =>
        Boolean(s.loadingConversationIds[conversationId])
    );
    const isStreaming = useConversationStore((s) =>
        Boolean(s.streamControllersById[conversationId])
    );
    const loadConversation = useConversationStore((s) => s.loadConversation);
    const loadSubagents = useConversationStore((s) => s.loadSubagents);
    const sendMessage = useConversationStore((s) => s.sendMessage);
    const stopGeneration = useConversationStore((s) => s.stopGeneration);
    const observeConversation = useConversationStore(
        (s) => s.observeConversation
    );

    const parentConversationId = conversation?.parent_conversation_id ?? null;
    const parentConversation = useConversationStore((s) =>
        parentConversationId
            ? (s.conversationsById[parentConversationId] ?? null)
            : null
    );

    const scrollButtonRef = useRef<HTMLDivElement>(null);
    const scrollToBottomRef = useRef<(() => void) | null>(null);

    useEffect(() => {
        if (activeWorkspaceId) {
            void loadConversation(activeWorkspaceId, conversationId);
        }
    }, [activeWorkspaceId, conversationId, loadConversation]);

    // Subagent pages don't start their own stream (the parent's `task` tool
    // does), so we attach a read-only observer to receive live SSE events.
    useEffect(() => {
        if (!activeWorkspaceId) return;
        if (!conversation?.parent_conversation_id) return;
        const dispose = observeConversation(activeWorkspaceId, conversationId);
        return () => {
            dispose();
        };
    }, [
        activeWorkspaceId,
        conversationId,
        conversation?.parent_conversation_id,
        observeConversation
    ]);

    // Ensure the parent conversation row is available for breadcrumbs.
    useEffect(() => {
        if (!activeWorkspaceId || !parentConversationId) return;
        if (parentConversation) return;
        void loadConversation(activeWorkspaceId, parentConversationId);
    }, [
        activeWorkspaceId,
        parentConversationId,
        parentConversation,
        loadConversation
    ]);

    // Hydrate known subagents for parent conversations so TaskBlock cards
    // render metadata (name/type) immediately after a page refresh without
    // needing the original subagent-started SSE event.
    useEffect(() => {
        if (!activeWorkspaceId) return;
        if (conversation?.parent_conversation_id) return;
        void loadSubagents(activeWorkspaceId, conversationId);
    }, [
        activeWorkspaceId,
        conversationId,
        conversation?.parent_conversation_id,
        loadSubagents
    ]);

    const navigate = useNavigate();

    const handleSend = (
        content: string,
        attachmentIds: string[],
        mentions: { path: string; type: "file" | "directory" }[],
        useSkillNames?: string[]
    ) => {
        if (!activeWorkspaceId || !conversation) return;
        // Mid-stream sends go into the per-conversation prompt queue; the
        // current turn's `finally` will FIFO-drain them via `sendMessage`
        // once the in-flight controller is gone. See
        // `runConversationStream` in `conversation-store.ts`.
        if (isStreaming) {
            usePromptQueueStore.getState().enqueue(conversation.id, {
                content,
                attachmentIds,
                mentions,
                useSkillNames
            });
            return;
        }
        void sendMessage(
            activeWorkspaceId,
            conversation.id,
            content,
            attachmentIds,
            mentions,
            useSkillNames
        );
    };

    const handleStop = () => {
        // Snapshot a few things up-front so we don't depend on stale state
        // after the async stop call resolves (the conversation row may
        // be gone by then for the brand-new-conversation path).
        const messages = conversation?.messages ?? [];
        const lastAssistant = [...messages]
            .reverse()
            .find((m) => m.role === "assistant");
        const isEarlyStop = isAssistantPlaceholderTurn(lastAssistant);

        // Latest user row regardless of role ordering — for early stops
        // this is the row the server will discard. It's normally the
        // last user message before the streaming assistant placeholder.
        const triggeringUserMessage = isEarlyStop
            ? [...messages].reverse().find((m) => m.role === "user")
            : null;
        const restoreContent = triggeringUserMessage?.content ?? "";
        const workspaceForStop = activeWorkspaceId;

        void (async () => {
            const result = await stopGeneration(
                conversationId,
                isEarlyStop ? { discardUserMessage: true } : undefined
            );

            // The non-early-stop path keeps the user/assistant rows in
            // place — nothing else to do beyond letting the SSE `abort`
            // event handler finalize the assistant footer.
            if (!isEarlyStop) return;

            // Restore the discarded prompt so the user can edit and
            // resend. Empty content is a degenerate case (the server
            // wouldn't have created a meaningful turn anyway) — skip
            // the draft write so we don't clobber whatever's already
            // sitting in the slot the user navigates to next.
            const snapshot = buildPlainTextDraft(restoreContent);

            if (result.conversationDeleted) {
                // Brand-new conversation, no prior turns: the server
                // tore the whole conversation down. Stash the prompt
                // on the home slot for the workspace we came from and
                // navigate there — the home page's `ChatInput` mounts
                // fresh against the home slot key, so its slot-change
                // hydrate will pick up the draft on first paint
                // without needing an epoch bump.
                if (snapshot && workspaceForStop) {
                    setDraft(
                        { kind: "home", workspaceId: workspaceForStop },
                        snapshot
                    );
                }
                void navigate({ to: "/" });
                return;
            }

            // Conversation lives on — restore the prompt into THIS
            // conversation's input. The slot key hasn't changed (we're
            // still on the same conversation), so we have to bump the
            // restore epoch to nudge the mounted `ChatInput` into
            // re-hydrating from the draft we just wrote.
            const slot: DraftSlot = {
                kind: "conversation",
                conversationId
            };
            if (snapshot) {
                setDraft(slot, snapshot);
                bumpRestoreEpoch(slot);
            }
        })();
    };

    const isSubagent = Boolean(conversation?.parent_conversation_id);
    const subagentType = conversation?.subagent_type as
        | SubagentType
        | null
        | undefined;
    const subagentName = conversation?.subagent_name ?? "subagent";
    const parentTitle = parentConversation?.title ?? "Parent conversation";

    let body: React.ReactNode;
    if (isLoadingConversation && !conversation) {
        body = (
            <div className="flex h-full items-center justify-center">
                <span className="text-sm text-dark-300">Loading...</span>
            </div>
        );
    } else if (!conversation) {
        body = (
            <div className="flex h-full items-center justify-center">
                <span className="text-sm text-dark-300">
                    Conversation not found
                </span>
            </div>
        );
    } else {
        const visibleMessages = conversation.messages.filter(
            (m) => m.role === "user" || m.role === "assistant"
        );

        body = (
            <>
                <div className="sticky top-0 z-10 shrink-0">
                    <div className="mx-auto flex items-center gap-1 px-2.5 py-1.5">
                        {isSubagent && parentConversationId ? (
                            <div className="flex items-center gap-1 text-xs">
                                <Link
                                    to="/conversations/$conversationId"
                                    params={{
                                        conversationId: parentConversationId
                                    }}
                                    className="max-w-[14rem] truncate rounded-md px-2 py-1 font-medium text-dark-100 hover:bg-dark-900 hover:text-dark-50 transition-colors"
                                >
                                    {parentTitle}
                                </Link>
                                <CaretRightIcon
                                    className="size-3 shrink-0 text-dark-400"
                                    weight="bold"
                                />
                                <div className="flex items-center gap-1.5 rounded-md px-2 py-1">
                                    <span className="truncate font-medium text-dark-50">
                                        {subagentName}
                                    </span>
                                    {subagentType ? (
                                        <span className="rounded-sm bg-dark-900 px-1.5 py-0.5 text-[10px] font-medium text-dark-200">
                                            {SUBAGENT_TYPE_LABEL[subagentType]}
                                        </span>
                                    ) : null}
                                </div>
                            </div>
                        ) : (
                            <Popover>
                                <PopoverTrigger
                                    type="button"
                                    className="w-auto max-w-full rounded-md text-xs hover:bg-dark-900 px-2.5 py-1 transition-colors"
                                >
                                    <span className="truncate font-medium">
                                        {conversation.title}
                                    </span>
                                </PopoverTrigger>
                                <PopoverContent
                                    align="start"
                                    sideOffset={10}
                                    className="flex flex-col gap-2 text-[11px]"
                                >
                                    {conversation.title && (
                                        <div className="flex items-center gap-2">
                                            <span className="text-dark-100">
                                                {conversation.title}
                                            </span>
                                        </div>
                                    )}
                                    <div className="flex items-center gap-2">
                                        <FolderNotchIcon
                                            className="size-3.5 shrink-0 text-dark-300"
                                            weight="duotone"
                                        />
                                        <div className="min-w-0 text-dark-100">
                                            {activeWorkspace?.path ??
                                                "No workspace selected"}
                                        </div>
                                    </div>
                                </PopoverContent>
                            </Popover>
                        )}

                        {!isPrimary && onClose ? (
                            <div className="ml-auto">
                                <Tooltip content="Close pane" side="bottom">
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onClose();
                                        }}
                                        className="flex size-6 items-center justify-center rounded-md text-dark-300 transition-colors hover:bg-dark-800 hover:text-dark-50"
                                    >
                                        <XIcon
                                            className="size-3.5"
                                            weight="bold"
                                        />
                                    </button>
                                </Tooltip>
                            </div>
                        ) : null}
                    </div>
                </div>

                <div
                    className="min-h-0 flex-1 overflow-hidden"
                    style={{
                        WebkitMaskImage:
                            "linear-gradient(to bottom, black calc(100% - 4rem), transparent 100%)",
                        maskImage:
                            "linear-gradient(to bottom, black calc(100% - 4rem), transparent 100%)"
                    }}
                >
                    <MessageList
                        messages={visibleMessages}
                        conversationId={conversation.id}
                        scrollButtonRef={scrollButtonRef}
                        scrollToBottomRef={scrollToBottomRef}
                    />
                </div>

                <div className="shrink-0">
                    <div className="mx-auto max-w-3xl px-4 pt-4 pb-2">
                        <div
                            ref={scrollButtonRef}
                            style={{
                                opacity: 0,
                                pointerEvents: "none",
                                transform: "translateY(4px)",
                                transition:
                                    "opacity 150ms ease, transform 150ms ease"
                            }}
                            className="mb-2 inline-flex"
                        >
                            <button
                                type="button"
                                onClick={() => scrollToBottomRef.current?.()}
                                className="flex items-center gap-1.5 rounded-full border border-dark-700 bg-dark-850 px-3 py-1.5 text-xs text-dark-100 shadow-sm transition-colors hover:bg-dark-700 hover:text-dark-50"
                            >
                                <ArrowDownIcon
                                    className="size-3.5"
                                    weight="bold"
                                />
                                Back to bottom
                            </button>
                        </div>
                        <ChatInput
                            onSend={handleSend}
                            onStop={handleStop}
                            isStreaming={isStreaming}
                            workspaceId={activeWorkspaceId}
                            conversationId={conversation.id}
                            placeholder={
                                isStreaming
                                    ? "Add to queue..."
                                    : "Send a message..."
                            }
                        />
                    </div>
                </div>
            </>
        );
    }

    // The pane only paints a focus indicator when the layout is actually
    // split — a single pane never needs the visual cue, so we keep it
    // visually identical to the pre-split layout in that case.
    return (
        <div
            className={cn(
                "relative flex h-full min-w-0 flex-col",
                splitActive && "transition-colors"
            )}
            onMouseDown={onFocus}
            onFocus={onFocus}
        >
            {splitActive ? (
                <div
                    aria-hidden
                    className={cn(
                        "pointer-events-none absolute inset-x-0 top-0 z-20 h-px transition-colors",
                        isFocused ? "bg-dark-50/40" : "bg-transparent"
                    )}
                />
            ) : null}
            {body}
        </div>
    );
}
