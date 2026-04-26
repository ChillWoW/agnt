import {
    ArrowUpIcon,
    PaperclipIcon,
    PlusIcon,
    StopIcon
} from "@phosphor-icons/react";
import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type DragEvent,
    type FormEvent
} from "react";
import {
    Button,
    Popover,
    PopoverContent,
    PopoverTrigger,
    Tooltip
} from "@/components/ui";
import { usePermissionStore } from "@/features/permissions";
import { useQuestionStore } from "@/features/questions";
import { usePendingAttachments } from "@/features/attachments";
import {
    clearDraft,
    draftSlotKey,
    getDraft,
    setDraft,
    type DraftSlot,
    type DraftSnapshot
} from "@/features/chat-drafts";
import { cn } from "@/lib/cn";
import { AttachmentBar } from "./AttachmentBar";
import { ContextMeter } from "./ContextMeter";
import { ModelSelector } from "./ModelSelector";
import { PermissionCard } from "./PermissionCard";
import { PermissionModeSelector } from "./PermissionModeSelector";
import { AgenticModeSelector } from "./AgenticModeSelector";
import { QuestionCard } from "./QuestionCard";
import { TodosCard } from "./TodosCard";
import {
    isMentionPopupOpen,
    MentionEditor,
    type MentionEditorHandle,
    type SerializedMention
} from "./editor";

interface ChatInputProps {
    onSend?: (
        value: string,
        attachmentIds: string[],
        mentions: SerializedMention[]
    ) => void;
    onStop?: () => void;
    isStreaming?: boolean;
    placeholder?: string;
    workspaceId?: string | null;
    conversationId?: string | null;
}

export function ChatInput({
    onSend,
    onStop,
    isStreaming,
    placeholder = "Ask anything...",
    workspaceId,
    conversationId
}: ChatInputProps) {
    const [draftText, setDraftText] = useState("");
    const [isEmpty, setIsEmpty] = useState(true);
    const [dragActive, setDragActive] = useState(false);
    const [addMenuOpen, setAddMenuOpen] = useState(false);
    const dragCounterRef = useRef(0);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const editorRef = useRef<MentionEditorHandle>(null);

    const slot = useMemo<DraftSlot | null>(() => {
        if (conversationId) {
            return { kind: "conversation", conversationId };
        }
        if (workspaceId) {
            return { kind: "home", workspaceId };
        }
        return null;
    }, [conversationId, workspaceId]);
    const slotKey = slot ? draftSlotKey(slot) : null;
    const previousSlotKeyRef = useRef<string | null>(null);
    const saveTimerRef = useRef<number | null>(null);
    // Holds the latest editor snapshot captured at keystroke time. We can't
    // pull state out of `editorRef.current` later because the editor may
    // unmount mid-debounce (e.g. a PermissionCard or QuestionCard pops over
    // it via the conditional render), which would silently drop the user's
    // last few keystrokes from persistence.
    const pendingSnapshotRef = useRef<
        { slot: DraftSlot; snapshot: DraftSnapshot } | null
    >(null);

    const writePendingSnapshot = useCallback(() => {
        const pending = pendingSnapshotRef.current;
        pendingSnapshotRef.current = null;
        if (!pending) return;
        const { slot: target, snapshot } = pending;
        if (
            !snapshot.docJSON ||
            snapshot.plainText.trim().length === 0
        ) {
            // Defer the empty-check on mentions to the store's own
            // isSnapshotEffectivelyEmpty: setDraft will fall through to
            // clearDraft if there are no mention nodes either.
            const doc = snapshot.docJSON as
                | { content?: ReadonlyArray<unknown> }
                | null
                | undefined;
            if (!doc || !Array.isArray(doc.content)) {
                clearDraft(target);
                return;
            }
        }
        setDraft(target, snapshot);
    }, []);

    const flushSaveTimer = useCallback(() => {
        if (saveTimerRef.current !== null) {
            window.clearTimeout(saveTimerRef.current);
            saveTimerRef.current = null;
        }
        writePendingSnapshot();
    }, [writePendingSnapshot]);

    const {
        pending,
        isUploading,
        addFiles,
        remove: removePending,
        clear: clearPending,
        takeReadyIds
    } = usePendingAttachments(workspaceId ?? null);

    const pendingQueue = usePermissionStore((s) =>
        conversationId ? s.pendingByConversationId[conversationId] : undefined
    );
    const pendingPermission = pendingQueue?.[0];
    const pendingCount = pendingQueue?.length ?? 0;

    const questionQueue = useQuestionStore((s) =>
        conversationId ? s.pendingByConversationId[conversationId] : undefined
    );
    const pendingQuestions = questionQueue?.[0];
    const questionCount = questionQueue?.length ?? 0;

    const hasPending = pending.length > 0;
    const hasText = !isEmpty && draftText.trim().length > 0;
    const canSend =
        !!workspaceId &&
        !isUploading &&
        (hasText || pending.some((p) => p.status === "ready"));

    const handleSend = useCallback(
        (event?: FormEvent<HTMLFormElement>) => {
            event?.preventDefault();

            if (!canSend) return;
            // The user is mid-mention-selection — swallow the submit so Enter
            // picks the highlighted entry instead of sending the message.
            if (isMentionPopupOpen()) return;

            const serialized = editorRef.current?.serialize() ?? {
                text: "",
                mentions: []
            };
            const content = serialized.text.trim();
            const mentions = serialized.mentions;

            const attachmentIds = takeReadyIds();

            editorRef.current?.clear();
            setDraftText("");
            setIsEmpty(true);
            if (saveTimerRef.current !== null) {
                window.clearTimeout(saveTimerRef.current);
                saveTimerRef.current = null;
            }
            pendingSnapshotRef.current = null;
            if (slot) {
                clearDraft(slot);
            }
            clearPending();
            onSend?.(content, attachmentIds, mentions);
        },
        [canSend, clearPending, onSend, slot, takeReadyIds]
    );

    const handleEditorChange = useCallback(
        (serialized: { text: string; mentions: SerializedMention[] }) => {
            setDraftText(serialized.text);
            setIsEmpty(
                editorRef.current?.isEmpty() ?? serialized.text.length === 0
            );

            if (!slot) return;
            const editor = editorRef.current;
            if (!editor) return;

            // Capture the snapshot synchronously so fast typing right before
            // the editor unmounts (PermissionCard/QuestionCard, navigation,
            // etc.) is still preserved by the debounced flush below.
            const docJSON = editor.getDocJSON();
            pendingSnapshotRef.current = {
                slot,
                snapshot: {
                    docJSON,
                    plainText: serialized.text,
                    updatedAt: new Date().toISOString()
                }
            };

            if (saveTimerRef.current !== null) {
                window.clearTimeout(saveTimerRef.current);
            }
            saveTimerRef.current = window.setTimeout(() => {
                saveTimerRef.current = null;
                writePendingSnapshot();
            }, 250);
        },
        [slot, writePendingSnapshot]
    );

    useEffect(() => {
        const previousKey = previousSlotKeyRef.current;

        if (previousKey === slotKey) return;

        // Slot changed (or first mount with a slot). Flush any pending save
        // synchronously against whichever slot it was queued for so fast
        // typing right before navigating doesn't get dropped.
        flushSaveTimer();

        previousSlotKeyRef.current = slotKey;

        const editor = editorRef.current;
        if (!editor) return;

        if (!slot) {
            editor.clear();
            setDraftText("");
            setIsEmpty(true);
            return;
        }

        const snapshot = getDraft(slot);
        if (snapshot && snapshot.docJSON) {
            editor.setDocJSON(snapshot.docJSON);
            setDraftText(snapshot.plainText);
            setIsEmpty(snapshot.plainText.trim().length === 0);
        } else {
            editor.clear();
            setDraftText("");
            setIsEmpty(true);
        }
    }, [flushSaveTimer, slot, slotKey]);

    useEffect(() => {
        return () => {
            // Component unmounting — flush any pending save before the
            // editor goes away.
            flushSaveTimer();
        };
    }, [flushSaveTimer]);

    const handleEditorSubmit = useCallback(() => {
        handleSend();
    }, [handleSend]);

    const handlePasteFiles = useCallback(
        (files: FileList) => {
            if (!workspaceId) return;
            if (files.length > 0) {
                addFiles(files);
            }
        },
        [addFiles, workspaceId]
    );

    const handleFilePickerChange = (
        event: React.ChangeEvent<HTMLInputElement>
    ) => {
        if (!workspaceId) return;
        const files = event.target.files;
        if (files && files.length > 0) {
            addFiles(files);
        }
        event.target.value = "";
    };

    const openFilePicker = () => {
        setAddMenuOpen(false);
        fileInputRef.current?.click();
    };

    const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
        if (!workspaceId) return;
        if (!event.dataTransfer?.types.includes("Files")) return;
        event.preventDefault();
        dragCounterRef.current += 1;
        setDragActive(true);
    };

    const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
        if (!workspaceId) return;
        if (!event.dataTransfer?.types.includes("Files")) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
    };

    const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
        if (!workspaceId) return;
        event.preventDefault();
        dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
        if (dragCounterRef.current === 0) {
            setDragActive(false);
        }
    };

    const handleDrop = (event: DragEvent<HTMLDivElement>) => {
        if (!workspaceId) return;
        event.preventDefault();
        dragCounterRef.current = 0;
        setDragActive(false);
        const files = event.dataTransfer?.files;
        if (files && files.length > 0) {
            addFiles(files);
        }
    };

    return (
        <div className="flex flex-col gap-1.5">
            <div
                className={cn(
                    "relative rounded-sm border bg-dark-900 transition-colors",
                    dragActive
                        ? "border-dark-400 bg-dark-850"
                        : "border-dark-700"
                )}
                onDragEnter={handleDragEnter}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
            >
                {pendingQuestions && workspaceId && conversationId ? (
                    <QuestionCard
                        workspaceId={workspaceId}
                        conversationId={conversationId}
                        request={pendingQuestions}
                        queueLength={questionCount}
                    />
                ) : pendingPermission && workspaceId && conversationId ? (
                    <PermissionCard
                        workspaceId={workspaceId}
                        conversationId={conversationId}
                        request={pendingPermission}
                        queueLength={pendingCount}
                    />
                ) : (
                    <>
                        {workspaceId && conversationId && (
                            <TodosCard
                                workspaceId={workspaceId}
                                conversationId={conversationId}
                            />
                        )}
                        <AttachmentBar
                            attachments={pending}
                            onRemove={removePending}
                        />

                        <form
                            className="flex flex-col gap-3"
                            onSubmit={handleSend}
                        >
                            <div className="px-2.5 pt-1.5">
                                <MentionEditor
                                    ref={editorRef}
                                    workspaceId={workspaceId ?? null}
                                    placeholder={placeholder}
                                    initialContent={
                                        slot
                                            ? (getDraft(slot)?.docJSON ?? null)
                                            : null
                                    }
                                    onSubmit={handleEditorSubmit}
                                    onChange={handleEditorChange}
                                    onPasteFiles={handlePasteFiles}
                                />
                            </div>

                            <div className="flex items-center justify-between px-2.5 h-10 gap-1">
                                <div className="flex items-center gap-1">
                                    <Popover
                                        open={addMenuOpen}
                                        onOpenChange={setAddMenuOpen}
                                    >
                                        <PopoverTrigger
                                            disabled={!workspaceId}
                                            aria-label="Add attachments"
                                            className="flex size-7 shrink-0 items-center justify-center rounded-md text-dark-200 transition-colors hover:bg-dark-800 hover:text-dark-50 disabled:opacity-40 disabled:pointer-events-none outline-none"
                                        >
                                            <PlusIcon
                                                className="size-4"
                                                weight="bold"
                                            />
                                        </PopoverTrigger>
                                        <PopoverContent
                                            align="start"
                                            side="top"
                                            sideOffset={6}
                                            className="w-44 p-1"
                                        >
                                            <button
                                                type="button"
                                                onClick={openFilePicker}
                                                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs text-dark-100 transition-colors hover:bg-dark-800 hover:text-dark-50"
                                            >
                                                <PaperclipIcon
                                                    className="size-3.5"
                                                    weight="bold"
                                                />
                                                <span>Add file</span>
                                            </button>
                                        </PopoverContent>
                                    </Popover>

                                    <ModelSelector
                                        workspaceId={workspaceId}
                                        conversationId={conversationId}
                                    />
                                </div>

                                <div className="flex items-center gap-1">
                                    {isStreaming ? (
                                        <Tooltip content="Stop generating">
                                            <Button
                                                variant="ghost"
                                                onClick={onStop}
                                                className="size-7 shrink-0 rounded-md p-0 text-xs text-red-500 bg-red-500/15 hover:bg-red-500/20 hover:text-red-600"
                                            >
                                                <StopIcon
                                                    className="size-3.5"
                                                    weight="fill"
                                                />
                                            </Button>
                                        </Tooltip>
                                    ) : (
                                        <Tooltip content="Send">
                                            <Button
                                                variant="primary"
                                                disabled={!canSend}
                                                onClick={() => handleSend()}
                                                className="size-7 shrink-0 rounded-md p-0 text-xs"
                                            >
                                                <ArrowUpIcon
                                                    className="size-3.5"
                                                    weight="bold"
                                                />
                                            </Button>
                                        </Tooltip>
                                    )}
                                </div>
                            </div>
                        </form>

                        {dragActive && hasPending === false && (
                            <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-sm bg-dark-950/60 text-xs font-medium text-dark-50 backdrop-blur-sm">
                                Drop files to attach
                            </div>
                        )}

                        <input
                            ref={fileInputRef}
                            type="file"
                            multiple
                            className="hidden"
                            onChange={handleFilePickerChange}
                        />
                    </>
                )}
            </div>

            <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-1">
                    <AgenticModeSelector
                        workspaceId={workspaceId}
                        conversationId={conversationId}
                    />
                    <PermissionModeSelector
                        workspaceId={workspaceId}
                        conversationId={conversationId}
                    />
                </div>
                <ContextMeter
                    workspaceId={workspaceId}
                    conversationId={conversationId}
                    draft={draftText}
                    pendingAttachments={pending}
                />
            </div>
        </div>
    );
}
