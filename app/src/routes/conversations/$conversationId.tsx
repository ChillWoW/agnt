import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import {
    ArrowDownIcon,
    CaretRightIcon,
    FolderNotchIcon
} from "@phosphor-icons/react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui";
import { ChatInput } from "@/components/chat/ChatInput";
import { MessageList } from "@/components/chat/MessageList";
import { useConversationStore } from "@/features/conversations";
import type { SubagentType } from "@/features/conversations";
import { useWorkspaceStore } from "@/features/workspaces";

export const Route = createFileRoute("/conversations/$conversationId")({
    component: ConversationRoute
});

const SUBAGENT_TYPE_LABEL: Record<SubagentType, string> = {
    generalPurpose: "generalPurpose",
    explore: "explore",
    shell: "shell",
    docs: "docs",
    "best-of-n-runner": "best-of-n-runner"
};

function ConversationRoute() {
    const { conversationId } = Route.useParams();
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

    const handleSend = (
        content: string,
        attachmentIds: string[],
        mentions: { path: string; type: "file" | "directory" }[]
    ) => {
        if (!activeWorkspaceId || !conversation) return;
        void sendMessage(
            activeWorkspaceId,
            conversation.id,
            content,
            attachmentIds,
            mentions
        );
    };

    const handleStop = () => {
        stopGeneration(conversationId);
    };

    if (isLoadingConversation && !conversation) {
        return (
            <div className="flex h-full items-center justify-center">
                <span className="text-sm text-dark-300">Loading...</span>
            </div>
        );
    }

    if (!conversation) {
        return (
            <div className="flex h-full items-center justify-center">
                <span className="text-sm text-dark-300">
                    Conversation not found
                </span>
            </div>
        );
    }

    const visibleMessages = conversation.messages.filter(
        (m) => m.role === "user" || m.role === "assistant"
    );

    const isSubagent = Boolean(conversation.parent_conversation_id);
    const subagentType = conversation.subagent_type as SubagentType | null | undefined;
    const subagentName = conversation.subagent_name ?? "subagent";
    const parentTitle = parentConversation?.title ?? "Parent conversation";

    return (
        <div className="relative flex h-full flex-col">
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
                            <ArrowDownIcon className="size-3.5" weight="bold" />
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
                                ? "Waiting for response..."
                                : "Send a message..."
                        }
                    />
                </div>
            </div>
        </div>
    );
}
