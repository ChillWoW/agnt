import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { useLeftSidebarStore } from "./left-sidebar-store";
import { useHotkey } from "../hotkeys";
import {
    ArrowLeftIcon,
    NavigationArrowIcon,
    FolderOpenIcon,
    CaretRightIcon,
    ChatTeardropDotsIcon,
    ColumnsPlusRightIcon,
    TrashIcon,
    ArchiveIcon,
    ArrowCounterClockwiseIcon,
    PencilSimpleIcon,
    PlusIcon,
    PushPinSimpleIcon,
    PushPinSimpleSlashIcon,
    XIcon,
    MinusIcon,
    ShieldWarningIcon,
    GearSixIcon
} from "@phosphor-icons/react";
import {
    ContextMenu,
    Tooltip,
    Modal,
    ModalContent,
    ModalTitle,
    ModalDescription,
    ModalClose,
    Popover,
    PopoverTrigger,
    PopoverContent
} from "@/components/ui";
import { open } from "@tauri-apps/plugin-dialog";
import { LeftSidebarButton } from "./left-sidebar-button";
import { BinaryMatrix } from "./binary-matrix";
import { settingsCategories } from "@/components/settings/SettingsPanel";
import { useSettingsStore } from "@/components/settings";
import { useWorkspaceStore, HOME_WORKSPACE_ID } from "@/features/workspaces";
import { useConversationStore } from "@/features/conversations";
import { usePermissionStore } from "@/features/permissions";
import { useQuestionStore } from "@/features/questions";
import {
    MAX_PANES,
    SPLIT_PANE_DRAG_MIME,
    useSplitPaneStore
} from "@/features/split-panes";
import type { ElementType } from "react";
import { useNavigate } from "@tanstack/react-router";
import { AccountButton } from "./account-button";

const EMPTY_CONVERSATIONS: import("@/features/conversations").Conversation[] =
    [];

interface ConversationRowProps {
    conv: import("@/features/conversations").Conversation;
    workspaceId: string;
    isActive: boolean;
    isFocusedPane: boolean;
    isUnread: boolean;
    isStreaming: boolean;
    isPendingPermission: boolean;
    isPendingQuestion: boolean;
    splitFull: boolean;
    onOpen: (conversationId: string) => void;
    onSplit: (conversationId: string) => void;
}

function ConversationRow({
    conv,
    workspaceId,
    isActive,
    isFocusedPane,
    isUnread,
    isStreaming,
    isPendingPermission,
    isPendingQuestion,
    splitFull,
    onOpen,
    onSplit
}: ConversationRowProps) {
    const isPinned = Boolean(conv.pinned_at);
    const navigate = useNavigate();
    const [isEditing, setIsEditing] = useState(false);
    const [draft, setDraft] = useState(conv.title);
    const inputRef = useRef<HTMLInputElement>(null);
    // Tracks the latest edit-mode flag without going through React state, so
    // an Escape that fires `cancelEdit` can prevent the trailing `onBlur`
    // from racing in and committing the (now-discarded) draft.
    const editingRef = useRef(false);

    useEffect(() => {
        if (isEditing && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [isEditing]);

    // If the title changes from outside (e.g. server-generated title)
    // while we're not editing, keep the draft in sync.
    useEffect(() => {
        if (!editingRef.current) {
            setDraft(conv.title);
        }
    }, [conv.title]);

    const startEdit = () => {
        editingRef.current = true;
        setDraft(conv.title);
        setIsEditing(true);
    };

    const commitEdit = () => {
        if (!editingRef.current) return;
        editingRef.current = false;
        const next = draft.trim();
        setIsEditing(false);
        if (next.length === 0 || next === conv.title) {
            setDraft(conv.title);
            return;
        }
        void useConversationStore
            .getState()
            .renameConversation(workspaceId, conv.id, next);
    };

    const cancelEdit = () => {
        if (!editingRef.current) return;
        editingRef.current = false;
        setIsEditing(false);
        setDraft(conv.title);
    };

    const handleArchive = async () => {
        await useConversationStore
            .getState()
            .archiveConversation(workspaceId, conv.id);
        void navigate({ to: "/" });
    };

    const handleTogglePin = () => {
        const store = useConversationStore.getState();
        if (isPinned) {
            void store.unpinConversation(workspaceId, conv.id);
        } else {
            void store.pinConversation(workspaceId, conv.id);
        }
    };

    const handleDragStart = (e: React.DragEvent<HTMLDivElement>) => {
        if (isEditing) {
            e.preventDefault();
            return;
        }
        e.dataTransfer.setData(
            SPLIT_PANE_DRAG_MIME,
            JSON.stringify({
                workspaceId,
                conversationId: conv.id
            })
        );
        e.dataTransfer.effectAllowed = "copy";
    };

    // Middle-click ⇒ "Open in split". We swallow `mousedown` for button 1
    // to suppress the Windows autoscroll cursor, then act on `auxclick`
    // which fires once per middle button press.
    const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
        if (e.button === 1 && !isEditing) {
            e.preventDefault();
        }
    };

    const handleAuxClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if (e.button !== 1 || isEditing || splitFull) return;
        e.preventDefault();
        e.stopPropagation();
        onSplit(conv.id);
    };

    return (
        <ContextMenu>
            <ContextMenu.Trigger>
                <div
                    role="button"
                    tabIndex={0}
                    draggable={!isEditing}
                    onDragStart={handleDragStart}
                    onClick={() => {
                        if (isEditing) return;
                        onOpen(conv.id);
                    }}
                    onMouseDown={handleMouseDown}
                    onAuxClick={handleAuxClick}
                    onKeyDown={(e) => {
                        if (isEditing) return;
                        if (e.key === "Enter" || e.key === " ") {
                            onOpen(conv.id);
                        }
                    }}
                    className={cn(
                        "group relative flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] transition-colors min-w-0 w-full text-left cursor-pointer",
                        isActive
                            ? "bg-dark-800 text-dark-50"
                            : isUnread
                              ? "text-dark-50 hover:bg-dark-800"
                              : "text-dark-300 hover:bg-dark-800 hover:text-dark-100"
                    )}
                >
                    {isFocusedPane ? (
                        <span
                            aria-hidden
                            className="pointer-events-none absolute inset-y-1 left-0 w-0.5 rounded-full bg-dark-50/70"
                        />
                    ) : null}
                    {isPendingQuestion ? (
                        <ChatTeardropDotsIcon
                            className="size-3 shrink-0 text-dark-50 animate-pulse"
                            weight="fill"
                        />
                    ) : isPendingPermission ? (
                        <ShieldWarningIcon
                            className="size-3 shrink-0 text-dark-50 animate-pulse"
                            weight="fill"
                        />
                    ) : isStreaming ? (
                        <BinaryMatrix />
                    ) : (
                        // Both pinned and unpinned rows render the same
                        // hover-swap button: `MinusIcon` at rest, pin icon
                        // on row-hover. Clicking toggles pin state — which
                        // means the row in the Pinned group unpins, and a
                        // row in a workspace list pins. Pinned rows already
                        // live in their own sidebar group, so we don't need
                        // a persistent indicator on the row itself.
                        <button
                            type="button"
                            aria-label={
                                isPinned
                                    ? "Unpin conversation"
                                    : "Pin conversation"
                            }
                            onMouseDown={(e) => e.stopPropagation()}
                            onAuxClick={(e) => e.stopPropagation()}
                            onClick={(e) => {
                                e.stopPropagation();
                                handleTogglePin();
                            }}
                            className="relative shrink-0 size-3 cursor-pointer"
                        >
                            <MinusIcon
                                className={cn(
                                    "absolute inset-0 size-3 transition-opacity",
                                    "group-hover:opacity-0",
                                    isUnread
                                        ? "text-dark-50"
                                        : "text-dark-200"
                                )}
                            />
                            <PushPinSimpleIcon
                                className={cn(
                                    "absolute inset-0 size-3 opacity-0",
                                    "transition-opacity group-hover:opacity-100",
                                    "text-dark-300 hover:text-dark-50"
                                )}
                                weight={isPinned ? "fill" : "regular"}
                            />
                        </button>
                    )}
                    {isEditing ? (
                        <input
                            ref={inputRef}
                            type="text"
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            onMouseDown={(e) => e.stopPropagation()}
                            onKeyDown={(e) => {
                                e.stopPropagation();
                                if (e.key === "Enter") {
                                    e.preventDefault();
                                    commitEdit();
                                } else if (e.key === "Escape") {
                                    e.preventDefault();
                                    cancelEdit();
                                }
                            }}
                            onBlur={commitEdit}
                            className={cn(
                                "min-w-0 flex-1 rounded-sm bg-dark-700 px-1 py-0",
                                "text-[11px] text-dark-50",
                                "outline-none border border-dark-500",
                                "focus:border-dark-400"
                            )}
                        />
                    ) : (
                        <span className="truncate flex-1">{conv.title}</span>
                    )}
                    {!isEditing && (
                        <button
                            type="button"
                            aria-label="Archive conversation"
                            onMouseDown={(e) => e.stopPropagation()}
                            onAuxClick={(e) => e.stopPropagation()}
                            onClick={async (e) => {
                                e.stopPropagation();
                                await handleArchive();
                            }}
                            className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-dark-400 hover:text-dark-50 p-0.5"
                        >
                            <ArchiveIcon className="size-3" />
                        </button>
                    )}
                </div>
            </ContextMenu.Trigger>
            <ContextMenu.Content>
                <ContextMenu.Item
                    icon={
                        isPinned ? (
                            <PushPinSimpleSlashIcon className="size-3" />
                        ) : (
                            <PushPinSimpleIcon className="size-3" />
                        )
                    }
                    onClick={handleTogglePin}
                >
                    {isPinned ? "Unpin" : "Pin"}
                </ContextMenu.Item>
                <ContextMenu.Item
                    icon={<PencilSimpleIcon className="size-3" />}
                    onClick={startEdit}
                >
                    Rename
                </ContextMenu.Item>
                <ContextMenu.Item
                    icon={<ColumnsPlusRightIcon className="size-3" />}
                    disabled={splitFull}
                    onClick={() => {
                        if (splitFull) return;
                        onSplit(conv.id);
                    }}
                    shortcut={splitFull ? `Max ${MAX_PANES}` : undefined}
                >
                    Open in split
                </ContextMenu.Item>
                <ContextMenu.Separator />
                <ContextMenu.Item
                    icon={<ArchiveIcon className="size-3" />}
                    onClick={() => {
                        void handleArchive();
                    }}
                >
                    Archive
                </ContextMenu.Item>
            </ContextMenu.Content>
        </ContextMenu>
    );
}

function WorkspaceConversations({ workspaceId }: { workspaceId: string }) {
    const navigate = useNavigate();
    const conversations = useConversationStore(
        (s) => s.conversationsByWorkspace[workspaceId] ?? EMPTY_CONVERSATIONS
    );
    const activeConversationId = useConversationStore(
        (s) => s.activeConversationId
    );
    const setConversationWorkspace = useConversationStore(
        (s) => s.setConversationWorkspace
    );
    const unreadConversationIds = useConversationStore(
        (s) => s.unreadConversationIds
    );
    const streamingConversationIds = useConversationStore(
        (s) => s.streamControllersById
    );
    const pendingPermissions = usePermissionStore(
        (s) => s.pendingByConversationId
    );
    const pendingQuestions = useQuestionStore((s) => s.pendingByConversationId);

    // ── Split-pane integration ───────────────────────────────────────────
    //
    // Split panes are GLOBAL — each pane carries its own workspaceId, so
    // panes from multiple workspaces can coexist side-by-side. Click and
    // Split actions therefore work on every workspace's row regardless of
    // which workspace is currently "active"; the focused pane is the
    // routing target either way.
    //
    // Active workspace is still relevant for some UX bits (the file tree
    // / terminals follow it, the home screen creates new agents inside
    // it), so we still update it on cross-workspace open clicks below —
    // but the split layout itself no longer depends on it.
    const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
    const setActiveWorkspace = useWorkspaceStore((s) => s.setActive);

    const extraPanes = useSplitPaneStore((s) => s.extraPanes);
    const focusedPaneIndex = useSplitPaneStore((s) => s.focusedPaneIndex);
    const replaceSecondaryConversation = useSplitPaneStore(
        (s) => s.replaceSecondaryConversation
    );
    const setFocusedPaneIndex = useSplitPaneStore(
        (s) => s.setFocusedPaneIndex
    );
    const addPane = useSplitPaneStore((s) => s.addPane);

    const totalPanes = extraPanes.length + 1;
    const splitFull = totalPanes >= MAX_PANES;

    // Conversations from THIS workspace currently rendered in any pane.
    // The primary pane's conversation is whatever the URL points to,
    // mirrored into `activeConversationId` by the route effect — it
    // belongs to this workspace iff the route resolved against this
    // workspace (route uses `workspaceIdByConversationId` so cross-
    // workspace navigations still resolve correctly). Secondary panes
    // come from the global split store and are filtered by workspace
    // here so each sidebar group only highlights its own rows.
    const openPaneConvIds = useMemo(() => {
        const ids = new Set<string>();
        if (
            activeConversationId &&
            activeWorkspaceId === workspaceId
        ) {
            ids.add(activeConversationId);
        }
        for (const p of extraPanes) {
            if (p.workspaceId === workspaceId) {
                ids.add(p.conversationId);
            }
        }
        return ids;
    }, [activeConversationId, activeWorkspaceId, workspaceId, extraPanes]);

    const focusedPaneConvId = useMemo(() => {
        if (focusedPaneIndex === 0) {
            // The primary pane is URL-bound; only show as focused on
            // this workspace if the active conversation actually
            // belongs here.
            return activeWorkspaceId === workspaceId
                ? (activeConversationId ?? null)
                : null;
        }
        const extra = extraPanes[focusedPaneIndex - 1];
        if (!extra) return null;
        return extra.workspaceId === workspaceId
            ? extra.conversationId
            : null;
    }, [
        activeWorkspaceId,
        workspaceId,
        activeConversationId,
        extraPanes,
        focusedPaneIndex
    ]);

    const handleOpen = useCallback(
        (conversationId: string) => {
            // Replace the focused pane with the clicked conversation.
            // The pane carries its own `workspaceId` so cross-workspace
            // replacements work without touching the active workspace.
            if (focusedPaneIndex === 0) {
                // Primary pane is URL-bound. Pre-populate the
                // conversationId → workspaceId map so the route resolves
                // against this conversation's owning workspace
                // synchronously, even if the active workspace is
                // something else.
                setConversationWorkspace(conversationId, workspaceId);
                // Still flip the active workspace on cross-workspace
                // primary opens — the right sidebar (terminals / files)
                // and home screen track the active workspace, and a
                // primary-pane click reads as "switch to this
                // workspace" in the user's mental model.
                if (activeWorkspaceId !== workspaceId) {
                    void setActiveWorkspace(workspaceId);
                }
                void navigate({
                    to: "/conversations/$conversationId",
                    params: { conversationId }
                });
                return;
            }
            replaceSecondaryConversation(
                focusedPaneIndex,
                workspaceId,
                conversationId
            );
            setFocusedPaneIndex(focusedPaneIndex);
        },
        [
            activeWorkspaceId,
            focusedPaneIndex,
            navigate,
            replaceSecondaryConversation,
            setActiveWorkspace,
            setConversationWorkspace,
            setFocusedPaneIndex,
            workspaceId
        ]
    );

    const handleSplit = useCallback(
        (conversationId: string) => {
            addPane(workspaceId, conversationId);
        },
        [addPane, workspaceId]
    );

    useEffect(() => {
        void useConversationStore.getState().loadConversations(workspaceId);
    }, [workspaceId]);

    // Pinned rows live in the global Pinned group at the top of the
    // sidebar, so we hide them from each workspace's normal list (the
    // pin state is just a `pinned_at` timestamp on the same Conversation
    // row, no separate bucket needed).
    const visibleConversations = useMemo(
        () => conversations.filter((c) => !c.pinned_at),
        [conversations]
    );

    return (
        <div className="flex flex-col gap-0.5">
            {visibleConversations.map((conv) => (
                <ConversationRow
                    key={conv.id}
                    conv={conv}
                    workspaceId={workspaceId}
                    isActive={openPaneConvIds.has(conv.id)}
                    // `focusedPaneConvId` is already null when the
                    // focused pane belongs to a different workspace, so
                    // a simple equality check is enough.
                    isFocusedPane={focusedPaneConvId === conv.id}
                    isUnread={Boolean(unreadConversationIds[conv.id])}
                    isStreaming={Boolean(streamingConversationIds[conv.id])}
                    isPendingPermission={
                        (pendingPermissions[conv.id]?.length ?? 0) > 0
                    }
                    isPendingQuestion={
                        (pendingQuestions[conv.id]?.length ?? 0) > 0
                    }
                    splitFull={splitFull}
                    onOpen={handleOpen}
                    onSplit={handleSplit}
                />
            ))}
        </div>
    );
}

const EMPTY_ARCHIVED: import("@/features/conversations").Conversation[] = [];

function ConfirmDeleteDialog({
    open,
    onOpenChange,
    title,
    onConfirm
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    onConfirm: () => void;
}) {
    return (
        <Modal open={open} onOpenChange={onOpenChange}>
            <ModalContent className="p-5">
                <ModalTitle>Delete permanently?</ModalTitle>
                <ModalDescription>
                    &quot;{title}&quot; will be erased. This cannot be undone.
                </ModalDescription>
                <div className="mt-5 flex justify-end gap-2">
                    <ModalClose className="text-sm">Cancel</ModalClose>
                    <button
                        type="button"
                        onClick={() => {
                            onConfirm();
                            onOpenChange(false);
                        }}
                        className="inline-flex items-center justify-center rounded-md bg-red-500/90 px-3 py-1.5 text-sm text-white transition-colors hover:bg-red-500"
                    >
                        Delete
                    </button>
                </div>
            </ModalContent>
        </Modal>
    );
}

function WorkspaceArchivedList({
    workspaceId,
    onPickDelete,
    onClose
}: {
    workspaceId: string;
    onPickDelete: (conversationId: string) => void;
    onClose: () => void;
}) {
    const navigate = useNavigate();
    const archived = useConversationStore(
        (s) => s.archivedByWorkspace[workspaceId] ?? EMPTY_ARCHIVED
    );
    const activeConversationId = useConversationStore(
        (s) => s.activeConversationId
    );
    const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
    const setActiveWorkspace = useWorkspaceStore((s) => s.setActive);

    useEffect(() => {
        void useConversationStore
            .getState()
            .loadArchivedConversations(workspaceId);
    }, [workspaceId]);

    // Same per-workspace SQLite caveat as the live conversation list:
    // navigating to a conversation owned by a non-active workspace
    // would 404 against the previously active workspace's DB. Pre-
    // populate the conversation→workspace map (so the route resolves
    // against the right workspace immediately), then flip the active
    // workspace so the rest of the app (file tree / terminals / home)
    // follows.
    const openArchivedConversation = (conversationId: string) => {
        useConversationStore
            .getState()
            .setConversationWorkspace(conversationId, workspaceId);
        if (activeWorkspaceId !== workspaceId) {
            void setActiveWorkspace(workspaceId);
        }
        void navigate({
            to: "/conversations/$conversationId",
            params: { conversationId }
        });
        onClose();
    };

    if (archived.length === 0) {
        return (
            <p className="px-2 py-3 text-center text-[11px] text-dark-400">
                No archived conversations.
            </p>
        );
    }

    return (
        <div className="flex max-h-80 flex-col gap-0.5 overflow-y-auto">
            {archived.map((conv) => {
                const isActive = activeConversationId === conv.id;
                return (
                    <div
                        key={conv.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => openArchivedConversation(conv.id)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                                openArchivedConversation(conv.id);
                            }
                        }}
                        className={cn(
                            "group flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] transition-colors min-w-0 w-full text-left cursor-pointer",
                            isActive
                                ? "bg-dark-800 text-dark-50"
                                : "text-dark-300 hover:bg-dark-800 hover:text-dark-100"
                        )}
                    >
                        <MinusIcon className="size-3 shrink-0 text-dark-400" />
                        <span className="truncate flex-1">{conv.title}</span>
                        <Tooltip content="Restore" side="top">
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    void useConversationStore
                                        .getState()
                                        .unarchiveConversation(
                                            workspaceId,
                                            conv.id
                                        );
                                }}
                                className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-dark-200 hover:text-dark-50 p-0.5"
                            >
                                <ArrowCounterClockwiseIcon className="size-3" />
                            </button>
                        </Tooltip>
                        <Tooltip content="Delete permanently" side="top">
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onPickDelete(conv.id);
                                }}
                                className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-dark-200 hover:text-red-400 p-0.5"
                            >
                                <TrashIcon className="size-3" />
                            </button>
                        </Tooltip>
                    </div>
                );
            })}
        </div>
    );
}

function WorkspaceRow({
    ws,
    isActive,
    isExpanded,
    isDragging,
    isDropBefore,
    isDropAfter,
    onToggleExpanded,
    onSetActive,
    onRemove,
    onDragStart,
    onDragOver,
    onDrop,
    onDragEnd
}: {
    ws: { id: string; name: string };
    isActive: boolean;
    isExpanded: boolean;
    isDragging: boolean;
    isDropBefore: boolean;
    isDropAfter: boolean;
    onToggleExpanded: (id: string) => void;
    onSetActive: (id: string) => void;
    onRemove: (id: string) => void;
    onDragStart: (id: string) => void;
    onDragOver: (e: React.DragEvent, id: string) => void;
    onDrop: (e: React.DragEvent, id: string) => void;
    onDragEnd: () => void;
}) {
    const navigate = useNavigate();
    const [archivedOpen, setArchivedOpen] = useState(false);
    const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

    const archived = useConversationStore(
        (s) => s.archivedByWorkspace[ws.id] ?? EMPTY_ARCHIVED
    );
    const pendingDelete = pendingDeleteId
        ? archived.find((c) => c.id === pendingDeleteId)
        : null;
    // Home workspace is always present and pinned to the top — drag and
    // the "Close workspace" action don't apply to it.
    const isHome = ws.id === HOME_WORKSPACE_ID;

    return (
        <div
            className={cn(
                "flex flex-col transition-opacity",
                isDragging && "opacity-40"
            )}
            draggable={!isHome}
            onDragStart={isHome ? undefined : () => onDragStart(ws.id)}
            onDragOver={isHome ? undefined : (e) => onDragOver(e, ws.id)}
            onDrop={isHome ? undefined : (e) => onDrop(e, ws.id)}
            onDragEnd={isHome ? undefined : onDragEnd}
        >
            {isDropBefore && (
                <div className="h-0.5 rounded-full bg-dark-400 mx-1 mb-0.5" />
            )}
            <ContextMenu>
                <ContextMenu.Trigger>
                    <div className="group flex items-center gap-1 px-1 py-1 rounded-md text-[11px] transition-colors min-w-0 w-full">
                        <button
                            onClick={() => onToggleExpanded(ws.id)}
                            className={cn(
                                "flex items-center gap-1 min-w-0 flex-1 text-left",
                                isActive
                                    ? "text-dark-50"
                                    : "text-dark-200 hover:text-dark-50"
                            )}
                        >
                            <CaretRightIcon
                                className={cn(
                                    "size-2.5 shrink-0 transition-transform duration-100",
                                    isExpanded && "rotate-90"
                                )}
                                weight="bold"
                            />
                            <span className="truncate font-medium">
                                {ws.name}
                            </span>
                        </button>

                        <Popover
                            open={archivedOpen}
                            onOpenChange={setArchivedOpen}
                        >
                            <div className="flex items-center gap-1 shrink-0">
                                <Tooltip content="New Agent" side="top">
                                    <button
                                        onClick={() => {
                                            void onSetActive(ws.id);
                                            void navigate({ to: "/" });
                                        }}
                                        className="opacity-0 group-hover:opacity-100 transition-opacity text-dark-200 hover:text-dark-100"
                                    >
                                        <PlusIcon className="size-3.5" />
                                    </button>
                                </Tooltip>

                                {/* Zero-size anchor in the row's right edge so
                                    the archived popover (opened via the
                                    context menu) positions next to the row. */}
                                <PopoverTrigger
                                    tabIndex={-1}
                                    aria-hidden
                                    render={<span />}
                                    style={{
                                        width: 0,
                                        height: 0,
                                        opacity: 0,
                                        pointerEvents: "none",
                                        display: "inline-block",
                                        overflow: "hidden"
                                    }}
                                />
                            </div>
                            <PopoverContent
                                side="right"
                                align="start"
                                sideOffset={8}
                                className="w-72 p-1.5"
                            >
                                <div className="flex items-center justify-between gap-2 px-1.5 pt-1 pb-1.5">
                                    <p className="truncate text-[11px] font-semibold uppercase text-dark-300">
                                        Archived in {ws.name}
                                    </p>
                                    <span className="shrink-0 text-[10px] text-dark-300">
                                        {archived.length}
                                    </span>
                                </div>
                                <WorkspaceArchivedList
                                    workspaceId={ws.id}
                                    onPickDelete={(id) =>
                                        setPendingDeleteId(id)
                                    }
                                    onClose={() => setArchivedOpen(false)}
                                />
                            </PopoverContent>
                        </Popover>
                    </div>
                </ContextMenu.Trigger>
                <ContextMenu.Content>
                    <ContextMenu.Item
                        icon={<PlusIcon className="size-3" />}
                        onClick={() => {
                            void onSetActive(ws.id);
                            void navigate({ to: "/" });
                        }}
                    >
                        New agent
                    </ContextMenu.Item>
                    <ContextMenu.Item
                        icon={<ArchiveIcon className="size-3" />}
                        onClick={() => {
                            void useConversationStore
                                .getState()
                                .loadArchivedConversations(ws.id);
                            setArchivedOpen(true);
                        }}
                    >
                        View archived
                    </ContextMenu.Item>
                    {!isHome && (
                        <>
                            <ContextMenu.Separator />
                            <ContextMenu.Item
                                destructive
                                icon={<XIcon className="size-3" />}
                                onClick={() => onRemove(ws.id)}
                            >
                                Close workspace
                            </ContextMenu.Item>
                        </>
                    )}
                </ContextMenu.Content>
            </ContextMenu>

            {isExpanded && (
                <div className="ml-3 mt-0.5 border-l border-dark-700 pl-1.5">
                    <WorkspaceConversations workspaceId={ws.id} />
                </div>
            )}
            {isDropAfter && (
                <div className="h-0.5 rounded-full bg-dark-400 mx-1 mt-0.5" />
            )}

            <ConfirmDeleteDialog
                open={pendingDeleteId !== null}
                onOpenChange={(open) => {
                    if (!open) setPendingDeleteId(null);
                }}
                title={pendingDelete?.title ?? ""}
                onConfirm={() => {
                    if (!pendingDeleteId) return;
                    void useConversationStore
                        .getState()
                        .deleteConversation(ws.id, pendingDeleteId);
                    setPendingDeleteId(null);
                }}
            />
        </div>
    );
}

interface PinnedEntry {
    conv: import("@/features/conversations").Conversation;
    workspaceId: string;
    workspaceName: string;
}

/**
 * Renders pinned conversations from every workspace in a single group at
 * the top of the sidebar (above all workspace lists, below "New Agent").
 *
 * Data flow: we read each workspace's `conversationsByWorkspace` bucket
 * — populated eagerly on sidebar mount in `useEagerLoadAllConversations`
 * — and pick out rows where `pinned_at` is set. Sorting by `pinned_at
 * DESC` makes the most recently pinned row float to the top, which
 * matches the server's `ORDER BY pinned_at DESC` for the workspace list
 * (since pin state is a single timestamp, "re-pin" is implemented by
 * overwriting the timestamp).
 *
 * The group hides itself entirely when no conversations are pinned, so
 * the sidebar layout doesn't reserve empty space.
 */
function PinnedGroup() {
    const navigate = useNavigate();
    const { workspaces } = useWorkspaceStore();
    const conversationsByWorkspace = useConversationStore(
        (s) => s.conversationsByWorkspace
    );
    const activeConversationId = useConversationStore(
        (s) => s.activeConversationId
    );
    const setConversationWorkspace = useConversationStore(
        (s) => s.setConversationWorkspace
    );
    const unreadConversationIds = useConversationStore(
        (s) => s.unreadConversationIds
    );
    const streamingConversationIds = useConversationStore(
        (s) => s.streamControllersById
    );
    const pendingPermissions = usePermissionStore(
        (s) => s.pendingByConversationId
    );
    const pendingQuestions = useQuestionStore((s) => s.pendingByConversationId);

    const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
    const setActiveWorkspace = useWorkspaceStore((s) => s.setActive);

    const extraPanes = useSplitPaneStore((s) => s.extraPanes);
    const focusedPaneIndex = useSplitPaneStore((s) => s.focusedPaneIndex);
    const replaceSecondaryConversation = useSplitPaneStore(
        (s) => s.replaceSecondaryConversation
    );
    const setFocusedPaneIndex = useSplitPaneStore(
        (s) => s.setFocusedPaneIndex
    );
    const addPane = useSplitPaneStore((s) => s.addPane);

    const isCollapsed = useLeftSidebarStore((s) => s.isPinnedGroupCollapsed);
    const setCollapsed = useLeftSidebarStore(
        (s) => s.setPinnedGroupCollapsed
    );

    const totalPanes = extraPanes.length + 1;
    const splitFull = totalPanes >= MAX_PANES;

    const pinnedEntries = useMemo<PinnedEntry[]>(() => {
        const out: PinnedEntry[] = [];
        for (const ws of workspaces) {
            const list = conversationsByWorkspace[ws.id];
            if (!list) continue;
            for (const conv of list) {
                if (conv.pinned_at) {
                    out.push({
                        conv,
                        workspaceId: ws.id,
                        workspaceName: ws.name
                    });
                }
            }
        }
        // Most recently pinned floats to the top. `pinned_at` is an ISO
        // timestamp so plain string compare is correct ordering-wise.
        out.sort((a, b) =>
            (b.conv.pinned_at ?? "").localeCompare(a.conv.pinned_at ?? "")
        );
        return out;
    }, [workspaces, conversationsByWorkspace]);

    const openPaneConvIds = useMemo(() => {
        const ids = new Set<string>();
        if (activeConversationId) ids.add(activeConversationId);
        for (const p of extraPanes) ids.add(p.conversationId);
        return ids;
    }, [activeConversationId, extraPanes]);

    const focusedPaneConvId = useMemo(() => {
        if (focusedPaneIndex === 0) return activeConversationId;
        const extra = extraPanes[focusedPaneIndex - 1];
        return extra ? extra.conversationId : null;
    }, [activeConversationId, extraPanes, focusedPaneIndex]);

    const handleOpen = useCallback(
        (entry: PinnedEntry) => {
            const { workspaceId, conv } = entry;
            const conversationId = conv.id;
            if (focusedPaneIndex === 0) {
                setConversationWorkspace(conversationId, workspaceId);
                if (activeWorkspaceId !== workspaceId) {
                    void setActiveWorkspace(workspaceId);
                }
                void navigate({
                    to: "/conversations/$conversationId",
                    params: { conversationId }
                });
                return;
            }
            replaceSecondaryConversation(
                focusedPaneIndex,
                workspaceId,
                conversationId
            );
            setFocusedPaneIndex(focusedPaneIndex);
        },
        [
            activeWorkspaceId,
            focusedPaneIndex,
            navigate,
            replaceSecondaryConversation,
            setActiveWorkspace,
            setConversationWorkspace,
            setFocusedPaneIndex
        ]
    );

    const handleSplit = useCallback(
        (entry: PinnedEntry) => {
            addPane(entry.workspaceId, entry.conv.id);
        },
        [addPane]
    );

    if (pinnedEntries.length === 0) return null;

    return (
        <div className="flex flex-col">
            <button
                type="button"
                onClick={() => setCollapsed(!isCollapsed)}
                className="group flex w-full items-center gap-1 px-1 py-1 rounded-md text-[11px] text-dark-200 hover:text-dark-50 transition-colors"
            >
                <CaretRightIcon
                    className={cn(
                        "size-2.5 shrink-0 transition-transform duration-100",
                        !isCollapsed && "rotate-90"
                    )}
                    weight="bold"
                />
                <span className="truncate font-medium">Pinned</span>
            </button>
            {!isCollapsed && (
                <div className="ml-3 mt-0.5 border-l border-dark-700 pl-1.5 flex flex-col gap-0.5">
                    {pinnedEntries.map((entry) => (
                        <ConversationRow
                            key={entry.conv.id}
                            conv={entry.conv}
                            workspaceId={entry.workspaceId}
                            isActive={openPaneConvIds.has(entry.conv.id)}
                            isFocusedPane={
                                focusedPaneConvId === entry.conv.id
                            }
                            isUnread={Boolean(
                                unreadConversationIds[entry.conv.id]
                            )}
                            isStreaming={Boolean(
                                streamingConversationIds[entry.conv.id]
                            )}
                            isPendingPermission={
                                (pendingPermissions[entry.conv.id]?.length ??
                                    0) > 0
                            }
                            isPendingQuestion={
                                (pendingQuestions[entry.conv.id]?.length ??
                                    0) > 0
                            }
                            splitFull={splitFull}
                            onOpen={() => handleOpen(entry)}
                            onSplit={() => handleSplit(entry)}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

/**
 * Side-effect hook: ensures every registered workspace has its
 * conversation list loaded into the store, regardless of whether the
 * workspace's row is currently expanded in the sidebar. Without this,
 * collapsed workspaces would never trigger `loadConversations`, and
 * pinned conversations belonging to those workspaces would silently
 * disappear from the global Pinned group until the user expanded them.
 *
 * Cheap: each call hits one per-workspace SQLite via the server route,
 * results are cached per workspace id, and follow-up renders short-
 * circuit on `workspaceId in conversationsByWorkspace`.
 */
function useEagerLoadAllConversations() {
    const workspaces = useWorkspaceStore((s) => s.workspaces);
    useEffect(() => {
        const store = useConversationStore.getState();
        for (const ws of workspaces) {
            void store.loadConversations(ws.id);
        }
    }, [workspaces]);
}

function WorkspaceSidebarList() {
    const { workspaces, activeWorkspaceId, setActive, remove } =
        useWorkspaceStore();
    const { workspaceOrder, setWorkspaceOrder } = useLeftSidebarStore();
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
    const [draggedId, setDraggedId] = useState<string | null>(null);
    const [dragOver, setDragOver] = useState<{
        id: string;
        position: "before" | "after";
    } | null>(null);

    useEffect(() => {
        if (activeWorkspaceId) {
            setExpandedIds((prev) => {
                const next = new Set(prev);
                next.add(activeWorkspaceId);
                return next;
            });
        }
    }, [activeWorkspaceId]);

    if (workspaces.length === 0) {
        return null;
    }

    const sortedWorkspaces = [...workspaces].sort((a, b) => {
        // Home is always pinned to index 0, regardless of any
        // user-driven drag-reorder. The user cannot move it in the UI
        // (drag handlers on its row are disabled), but we still force
        // it here so we don't depend on `workspaceOrder` happening to
        // include the home id.
        if (a.id === HOME_WORKSPACE_ID) return -1;
        if (b.id === HOME_WORKSPACE_ID) return 1;
        const ai = workspaceOrder.indexOf(a.id);
        const bi = workspaceOrder.indexOf(b.id);
        if (ai === -1 && bi === -1) return 0;
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
    });

    const toggleExpanded = (id: string) => {
        setExpandedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    };

    const handleDragStart = (id: string) => {
        setDraggedId(id);
    };

    const handleDragOver = (e: React.DragEvent, id: string) => {
        e.preventDefault();
        if (id === draggedId) return;
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const position =
            e.clientY < rect.top + rect.height / 2 ? "before" : "after";
        setDragOver({ id, position });
    };

    const handleDrop = (e: React.DragEvent, targetId: string) => {
        e.preventDefault();
        if (!draggedId || draggedId === targetId || !dragOver) {
            setDraggedId(null);
            setDragOver(null);
            return;
        }
        const ids = sortedWorkspaces.map((w) => w.id);
        const from = ids.indexOf(draggedId);
        ids.splice(from, 1);
        const to = ids.indexOf(targetId);
        const insertAt = dragOver.position === "after" ? to + 1 : to;
        ids.splice(insertAt, 0, draggedId);
        setWorkspaceOrder(ids);
        setDraggedId(null);
        setDragOver(null);
    };

    const handleDragEnd = () => {
        setDraggedId(null);
        setDragOver(null);
    };

    return (
        <div className="flex flex-col gap-1">
            {sortedWorkspaces.map((ws) => {
                const isActive = ws.id === activeWorkspaceId;
                const isExpanded = expandedIds.has(ws.id);
                const isDragging = draggedId === ws.id;
                const isDropBefore =
                    dragOver?.id === ws.id && dragOver.position === "before";
                const isDropAfter =
                    dragOver?.id === ws.id && dragOver.position === "after";

                return (
                    <WorkspaceRow
                        key={ws.id}
                        ws={ws}
                        isActive={isActive}
                        isExpanded={isExpanded}
                        isDragging={isDragging}
                        isDropBefore={isDropBefore}
                        isDropAfter={isDropAfter}
                        onToggleExpanded={toggleExpanded}
                        onSetActive={setActive}
                        onRemove={remove}
                        onDragStart={handleDragStart}
                        onDragOver={handleDragOver}
                        onDrop={handleDrop}
                        onDragEnd={handleDragEnd}
                    />
                );
            })}
        </div>
    );
}

function OpenWorkspaceButton() {
    const add = useWorkspaceStore((s) => s.add);

    const handleOpenWorkspace = async () => {
        const folder = await open({ directory: true, multiple: false });
        if (folder) {
            await add(folder);
        }
    };

    useHotkey({
        id: "workspace.open",
        label: "Open Workspace",
        defaultCombo: "Ctrl+P",
        handler: handleOpenWorkspace
    });

    return (
        <LeftSidebarButton
            Icon={FolderOpenIcon}
            label="Open Workspace"
            onClick={handleOpenWorkspace}
            hotkey="Ctrl+P"
        />
    );
}

function NewAgentButton() {
    const navigate = useNavigate();

    const handleNewAgent = () => {
        void navigate({ to: "/" });
    };

    useHotkey({
        id: "agent.new",
        label: "New Agent",
        defaultCombo: "Ctrl+N",
        handler: handleNewAgent
    });

    return (
        <LeftSidebarButton
            Icon={NavigationArrowIcon}
            label="New Agent"
            onClick={handleNewAgent}
            hotkey="Ctrl+N"
        />
    );
}

export function LeftSidebar() {
    const { isCollapsed, toggleSidebar } = useLeftSidebarStore();
    const {
        isOpen: settingsOpen,
        setActiveCategory: onSettingsCategoryChange,
        open: openSettings,
        close: closeSettings,
        activeCategory
    } = useSettingsStore();

    // Pin state lives on each conversation row; the global Pinned group
    // aggregates pinned rows from every workspace. We need conversation
    // lists loaded for ALL workspaces (not just the expanded ones) so
    // pinned rows from collapsed workspaces still show up.
    useEagerLoadAllConversations();

    useHotkey({
        id: "layout.sidebar.toggle",
        label: "Toggle sidebar",
        defaultCombo: "Ctrl+B",
        handler: toggleSidebar
    });

    const closeSettingsPanel = () => {
        onSettingsCategoryChange("hotkeys");
        closeSettings();
    };

    const toggleSettingsPanel = () => {
        if (settingsOpen) {
            closeSettingsPanel();
        } else {
            openSettings();
        }
    };

    return (
        <div className="relative shrink-0 border-r border-dark-700">
            <div
                className={cn(
                    "flex flex-col shrink-0 h-full transition-[width] duration-100 overflow-hidden",
                    isCollapsed ? "w-0" : "w-72"
                )}
            >
                <div className="flex h-full flex-col">
                    <div className="flex-1 min-h-0">
                        {settingsOpen ? (
                            <div className="flex h-full flex-col">
                                <div className="flex flex-col gap-4 px-2 py-3">
                                    <LeftSidebarButton
                                        Icon={ArrowLeftIcon}
                                        label="Back"
                                        onClick={closeSettingsPanel}
                                        hotkey="Esc"
                                    />

                                    <div className="flex flex-col gap-0.5">
                                        {settingsCategories.map((cat) => (
                                            <LeftSidebarButton
                                                key={cat.key}
                                                Icon={cat.icon as ElementType}
                                                label={cat.label}
                                                onClick={() =>
                                                    onSettingsCategoryChange?.(
                                                        cat.key
                                                    )
                                                }
                                                isActive={
                                                    settingsOpen &&
                                                    activeCategory === cat.key
                                                }
                                            />
                                        ))}
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="flex h-full flex-col px-2.5 pt-2.5">
                                <NewAgentButton />

                                <div className="mt-3 min-h-0 flex-1 overflow-y-auto flex flex-col gap-2">
                                    <PinnedGroup />
                                    <WorkspaceSidebarList />
                                </div>

                                <div className="shrink-0 pb-2.5 pt-1">
                                    <OpenWorkspaceButton />
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="flex shrink-0 items-center gap-1 border-t border-dark-700 px-2.5 py-2">
                        <div className="min-w-0 flex-1">
                            <AccountButton />
                        </div>

                        <Tooltip content="Settings" side="top">
                            <button
                                type="button"
                                onClick={toggleSettingsPanel}
                                className={cn(
                                    "flex size-9 shrink-0 items-center justify-center rounded-md text-dark-200 transition-colors hover:bg-dark-850 hover:text-dark-50",
                                    settingsOpen && "bg-dark-850 text-dark-50"
                                )}
                            >
                                <GearSixIcon className="size-4" weight="bold" />
                            </button>
                        </Tooltip>
                    </div>
                </div>
            </div>
        </div>
    );
}
