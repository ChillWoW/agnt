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
    useChatDraftsStore,
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
    isSlashPopupOpen,
    MentionEditor,
    type MentionEditorHandle,
    type SerializedMention
} from "./editor";
import type { SlashSelectDecision } from "./editor/SlashSuggestion";
import {
    extractLeadingSlashCommand,
    readCachedSlashCommands,
    type SlashCommand
} from "@/features/slash-commands";
import { useAgenticMode } from "@/features/plans";
import { usePermissionMode } from "@/features/permissions";

interface ChatInputProps {
    onSend?: (
        value: string,
        attachmentIds: string[],
        mentions: SerializedMention[],
        useSkillNames?: string[]
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
    // The serializer drops slash-marked tokens from `draftText` so the
    // message body never carries them. That means a draft consisting of
    // only `/<skillname>` would otherwise look "empty" to `canSend`. This
    // mirror flag tracks whether the editor still has any slash-marked
    // skill token so the send button stays enabled in that case.
    const [hasSlashMarks, setHasSlashMarks] = useState(false);
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

    const { setAgenticMode } = useAgenticMode({
        workspaceId,
        conversationId
    });
    const { setPermissionMode } = usePermissionMode({
        workspaceId,
        conversationId
    });

    /**
     * Fired the moment the user picks an entry from the slash-command
     * popover. Mode commands switch the corresponding mode on the spot
     * (no Enter required) and report `"consumed"` so the suggestion
     * plugin just deletes the typed `/<query>` range without inserting a
     * marked token. Skill commands fall through to `"insert"` so the
     * marked `/<name>` token lands in the editor for the user to send
     * with the rest of their message.
     */
    const handleSlashSelect = useCallback(
        (cmd: SlashCommand): SlashSelectDecision => {
            if (cmd.kind === "mode" && cmd.mode) {
                if (cmd.mode.kind === "agentic") {
                    void setAgenticMode(cmd.mode.value);
                } else {
                    void setPermissionMode(cmd.mode.value);
                }
                return "consumed";
            }
            return "insert";
        },
        [setAgenticMode, setPermissionMode]
    );

    const hasPending = pending.length > 0;
    const hasText = !isEmpty && draftText.trim().length > 0;
    // Slash mode commands (`/agent`, `/plan`, `/ask`, `/bypass`) typed
    // directly (without using the popover) act as a local UI toggle on
    // Enter. Detect that case so the send button / Enter path can run
    // even when the only thing in the draft is the slash text.
    const looksLikeLeadingSlash =
        hasText && /^\s*\/[a-zA-Z][\w-]*/.test(draftText);
    const canSend =
        !!workspaceId &&
        !isUploading &&
        (hasText ||
            pending.some((p) => p.status === "ready") ||
            looksLikeLeadingSlash ||
            hasSlashMarks);

    const resetEditorState = useCallback(() => {
        editorRef.current?.clear();
        setDraftText("");
        setIsEmpty(true);
        setHasSlashMarks(false);
        if (saveTimerRef.current !== null) {
            window.clearTimeout(saveTimerRef.current);
            saveTimerRef.current = null;
        }
        pendingSnapshotRef.current = null;
        if (slot) {
            clearDraft(slot);
        }
    }, [slot]);

    const handleSend = useCallback(
        (event?: FormEvent<HTMLFormElement>) => {
            event?.preventDefault();

            if (!canSend) return;
            // The user is mid-mention/slash-selection — swallow the submit
            // so Enter picks the highlighted entry instead of sending.
            if (isMentionPopupOpen() || isSlashPopupOpen()) return;

            const serialized = editorRef.current?.serialize() ?? {
                text: "",
                mentions: [],
                slashCommandNames: []
            };
            // `serialized.text` already excludes any slash-marked tokens
            // (the editor strips them during serialization, see
            // `serializeEditor` in `MentionEditor.tsx`); skill names are
            // surfaced via `slashCommandNames` instead.
            const cleanedText = serialized.text;
            const mentions = serialized.mentions;
            const cmds = readCachedSlashCommands(workspaceId);

            // Primary slash-command source: the marked tokens picked from
            // the popover. Mode commands never appear here — they're
            // intercepted in `handleSlashSelect` and fire immediately on
            // selection — so any name we see in this list is either a
            // skill or a prompt-kind command (`/init`). We split them by
            // kind because skills travel as the 4th `onSend` arg while
            // prompts are inlined into the message body.
            const slashNamesFromMarks = serialized.slashCommandNames.map(
                (n) => n.toLowerCase()
            );
            const skillNamesFromMarks = slashNamesFromMarks.filter((name) =>
                cmds.some(
                    (c) =>
                        c.kind === "skill" &&
                        c.name.toLowerCase() === name
                )
            );
            const promptCmdFromMarks = (() => {
                for (const name of slashNamesFromMarks) {
                    const found = cmds.find(
                        (c) =>
                            c.kind === "prompt" &&
                            c.name.toLowerCase() === name
                    );
                    if (found && found.prompt) return found;
                }
                return null;
            })();

            // Fallback for typed-but-not-popover paths: the user typed
            // `/agent` (or `/plan`, `/init`, etc.) at the start of the
            // message without clicking the popover, then hit Enter. This
            // branch catches mode commands typed verbatim and applies the
            // same immediate-toggle-then-bail behavior the popover
            // provides. Skill and prompt commands fall through to the
            // regular send path with their respective expansions.
            let textForSend = cleanedText;
            if (
                skillNamesFromMarks.length === 0 &&
                promptCmdFromMarks === null
            ) {
                const { command, rest } =
                    extractLeadingSlashCommand(cleanedText);
                const matched = command
                    ? cmds.find(
                          (c) => c.name.toLowerCase() === command
                      )
                    : null;

                if (matched && matched.kind === "mode" && matched.mode) {
                    if (matched.mode.kind === "agentic") {
                        void setAgenticMode(matched.mode.value);
                    } else {
                        void setPermissionMode(matched.mode.value);
                    }
                    if (rest.length === 0) {
                        resetEditorState();
                    } else {
                        editorRef.current?.setPlainText(rest);
                        setDraftText(rest);
                        setIsEmpty(false);
                    }
                    return;
                }

                if (matched && matched.kind === "skill") {
                    skillNamesFromMarks.push(matched.name.toLowerCase());
                    textForSend = rest;
                }

                if (matched && matched.kind === "prompt" && matched.prompt) {
                    textForSend =
                        rest.length > 0
                            ? `${matched.prompt}\n\n${rest}`
                            : matched.prompt;
                }
            } else if (promptCmdFromMarks && promptCmdFromMarks.prompt) {
                // Popover-selected prompt command: the marked token was
                // already stripped from `cleanedText` by the editor's
                // serializer, so anything left is the user's free-form
                // addendum. Inline the full prompt body and append the
                // addendum (if any) so extra context isn't lost.
                textForSend =
                    cleanedText.length > 0
                        ? `${promptCmdFromMarks.prompt}\n\n${cleanedText}`
                        : promptCmdFromMarks.prompt;
            }

            const useSkillNames = Array.from(new Set(skillNamesFromMarks));
            const content = textForSend.trim();

            // Skill-only message guard: if the popover-marked path picked
            // up a skill but the rest of the message is empty, we still
            // need SOMETHING to send to the server. Bail early — the user
            // probably meant to keep typing.
            if (
                content.length === 0 &&
                useSkillNames.length === 0 &&
                pending.every((p) => p.status !== "ready")
            ) {
                return;
            }

            const attachmentIds = takeReadyIds();

            resetEditorState();
            clearPending();
            onSend?.(
                content,
                attachmentIds,
                mentions,
                useSkillNames.length > 0 ? useSkillNames : undefined
            );
        },
        [
            canSend,
            clearPending,
            onSend,
            pending,
            resetEditorState,
            setAgenticMode,
            setPermissionMode,
            takeReadyIds,
            workspaceId
        ]
    );

    const handleEditorChange = useCallback(
        (serialized: {
            text: string;
            mentions: SerializedMention[];
            slashCommandNames: string[];
        }) => {
            setDraftText(serialized.text);
            setIsEmpty(
                editorRef.current?.isEmpty() ?? serialized.text.length === 0
            );
            setHasSlashMarks(serialized.slashCommandNames.length > 0);

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

    const loadEditorFromDraft = useCallback(() => {
        const editor = editorRef.current;
        if (!editor) return;

        if (!slot) {
            editor.clear();
            setDraftText("");
            setIsEmpty(true);
            setHasSlashMarks(false);
            return;
        }

        const snapshot = getDraft(slot);
        if (snapshot && snapshot.docJSON) {
            editor.setDocJSON(snapshot.docJSON);
            // The persisted snapshot's plain text excluded slash-marked
            // tokens at save time, but the docJSON still carries them as
            // marks — so re-serialize after hydrate to recover the live
            // slash-marks flag for the send button.
            const refreshed = editor.serialize();
            setDraftText(refreshed.text);
            setIsEmpty(editor.isEmpty());
            setHasSlashMarks(refreshed.slashCommandNames.length > 0);
        } else {
            editor.clear();
            setDraftText("");
            setIsEmpty(true);
            setHasSlashMarks(false);
        }
    }, [slot]);

    // Per-slot restore counter. The early-stop UX bumps this to push the
    // discarded prompt back into the live editor without remounting it.
    // Subscribing here means slot changes AND epoch bumps both flow
    // through the single applied-state tracker below.
    const restoreEpoch = useChatDraftsStore((s) =>
        slotKey ? (s.restoreEpoch[slotKey] ?? 0) : 0
    );
    const lastAppliedRef = useRef<{ slotKey: string | null; epoch: number }>({
        slotKey: null,
        epoch: 0
    });

    useEffect(() => {
        const last = lastAppliedRef.current;
        if (last.slotKey === slotKey && last.epoch === restoreEpoch) return;

        // Slot changed: flush any pending save synchronously against
        // whichever slot it was queued for so fast typing right before
        // navigating doesn't get dropped.
        if (last.slotKey !== slotKey) {
            flushSaveTimer();
        }
        lastAppliedRef.current = { slotKey, epoch: restoreEpoch };
        loadEditorFromDraft();
    }, [flushSaveTimer, loadEditorFromDraft, slotKey, restoreEpoch]);

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
                                    onSlashCommand={handleSlashSelect}
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
