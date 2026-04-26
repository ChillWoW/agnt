import {
    forwardRef,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef
} from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Content, Editor } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import HardBreak from "@tiptap/extension-hard-break";
import { Placeholder, UndoRedo } from "@tiptap/extensions";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { MentionExtension, serializeMentionLabel } from "./MentionExtension";
import {
    createMentionSuggestion,
    isMentionPopupActive,
    isMentionPopupOpen
} from "./MentionSuggestion";
import { SlashCommandMark } from "./SlashCommandMark";
import {
    isSlashPopupActive,
    isSlashPopupOpen,
    SlashSuggestionExtension,
    type SlashSelectDecision
} from "./SlashSuggestion";
import {
    prefetchWorkspaceTree,
    type MentionEntryType
} from "@/features/workspaces";
import {
    prefetchSlashCommands,
    type SlashCommand
} from "@/features/slash-commands";

export interface SerializedMention {
    path: string;
    type: MentionEntryType;
}

export interface SerializedEditor {
    text: string;
    mentions: SerializedMention[];
    /**
     * Names (without the leading `/`) of every slash-marked token currently
     * in the editor doc. These are emitted by the popover-select path only
     * and reflect what the user picked. The marked text is **excluded**
     * from `text` so the message body doesn't carry the slash command
     * verbatim — `ChatInput` strips one adjacent whitespace per skip so we
     * don't leave double-spaces.
     */
    slashCommandNames: string[];
}

export interface MentionEditorHandle {
    clear: () => void;
    focus: () => void;
    serialize: () => SerializedEditor;
    isEmpty: () => boolean;
    getDocJSON: () => unknown | null;
    setDocJSON: (json: unknown) => void;
    /**
     * Replace the editor content with a single paragraph containing the
     * given plain text (no mentions, no marks). Used by `ChatInput` when
     * stripping a leading mode command — the rest of the message stays
     * editable while the slash token disappears.
     */
    setPlainText: (text: string) => void;
}

interface MentionEditorProps {
    workspaceId: string | null | undefined;
    placeholder?: string;
    disabled?: boolean;
    initialContent?: unknown;
    onSubmit: () => void;
    onChange?: (serialized: SerializedEditor) => void;
    onPasteFiles?: (files: FileList) => void;
    /**
     * Fired the moment the user picks an entry from the slash-command
     * popover. Return `"consumed"` to suppress the default inline-token
     * insert (used for mode commands which switch mode immediately).
     * Return `"insert"` (or omit) to fall through to the default
     * skill-command insertion that leaves a marked `/<name>` token in the
     * editor for the user to send with the rest of their message.
     */
    onSlashCommand?: (cmd: SlashCommand) => SlashSelectDecision;
    className?: string;
}

function serializeEditor(editor: Editor): SerializedEditor {
    const mentions: SerializedMention[] = [];
    const slashCommandNames: string[] = [];
    let text = "";
    let firstBlock = true;
    // After we skip a slash-marked token, suppress one leading whitespace
    // from the next text emit so the message body doesn't carry a stray
    // double-space where the token used to be.
    let suppressLeadingWhitespace = false;

    editor.state.doc.forEach((block) => {
        if (!firstBlock) text += "\n";
        firstBlock = false;

        const walk = (node: ProseMirrorNode) => {
            if (node.type.name === "mention") {
                const attrs = node.attrs as {
                    id?: string;
                    label?: string;
                    type?: MentionEntryType;
                };
                if (attrs.id) {
                    const mentionType: MentionEntryType =
                        attrs.type === "directory" ? "directory" : "file";
                    mentions.push({
                        path: attrs.id,
                        type: mentionType
                    });
                    text += serializeMentionLabel({
                        id: attrs.id,
                        label: attrs.label ?? attrs.id,
                        type: mentionType
                    });
                }
                suppressLeadingWhitespace = false;
                return;
            }
            if (node.type.name === "hardBreak") {
                text += "\n";
                suppressLeadingWhitespace = false;
                return;
            }
            if (node.isText) {
                const isSlash = node.marks.some(
                    (m) => m.type.name === "slashCommand"
                );
                if (isSlash) {
                    const match = (node.text ?? "").match(
                        /^\s*\/([a-zA-Z][\w-]*)/
                    );
                    if (match) {
                        slashCommandNames.push(match[1].toLowerCase());
                    }
                    // Strip ONE adjacent space — prefer the space the
                    // suggestion plugin auto-inserts after the marked
                    // token (handled below by `suppressLeadingWhitespace`)
                    // so we don't double-strip when the user typed a
                    // space before the slash too. Touch `text` only if
                    // there's no following text-node to consume.
                    suppressLeadingWhitespace = true;
                    return;
                }
                let chunk = node.text ?? "";
                if (suppressLeadingWhitespace && chunk.startsWith(" ")) {
                    chunk = chunk.slice(1);
                }
                suppressLeadingWhitespace = false;
                text += chunk;
                return;
            }
            node.forEach(walk);
        };

        block.forEach(walk);
        suppressLeadingWhitespace = false;
    });

    return { text, mentions, slashCommandNames };
}

export const MentionEditor = forwardRef<MentionEditorHandle, MentionEditorProps>(
    (
        {
            workspaceId,
            placeholder = "Ask anything...",
            disabled,
            initialContent,
            onSubmit,
            onChange,
            onPasteFiles,
            onSlashCommand,
            className
        },
        ref
    ) => {
        const workspaceIdRef = useRef<string | null>(workspaceId ?? null);
        const onSubmitRef = useRef(onSubmit);
        const onChangeRef = useRef(onChange);
        const onPasteFilesRef = useRef(onPasteFiles);
        const onSlashCommandRef = useRef(onSlashCommand);
        // The initial content is captured once when the editor instance is
        // built — subsequent prop changes don't re-seed the editor (we use
        // the imperative `setDocJSON` handle for that).
        const initialContentRef = useRef(initialContent);

        useEffect(() => {
            workspaceIdRef.current = workspaceId ?? null;
            // Warm the root-tree cache so the very first @ press is
            // instantaneous instead of waiting on a network round-trip.
            // Same idea for slash commands so the skill list is ready by
            // the time the user types `/`.
            if (workspaceId) {
                prefetchWorkspaceTree(workspaceId, "");
                prefetchSlashCommands(workspaceId);
            }
        }, [workspaceId]);

        useEffect(() => {
            onSubmitRef.current = onSubmit;
        }, [onSubmit]);

        useEffect(() => {
            onChangeRef.current = onChange;
        }, [onChange]);

        useEffect(() => {
            onPasteFilesRef.current = onPasteFiles;
        }, [onPasteFiles]);

        useEffect(() => {
            onSlashCommandRef.current = onSlashCommand;
        }, [onSlashCommand]);

        const extensions = useMemo(
            () => [
                Document,
                Paragraph,
                Text,
                HardBreak,
                UndoRedo,
                Placeholder.configure({ placeholder }),
                SlashCommandMark,
                SlashSuggestionExtension.configure({
                    getWorkspaceId: () => workspaceIdRef.current,
                    onSelectCommand: (cmd) =>
                        onSlashCommandRef.current?.(cmd) ?? "insert"
                }),
                MentionExtension.configure({
                    HTMLAttributes: { class: "mention-chip" },
                    deleteTriggerWithBackspace: true,
                    renderText: ({ node }) =>
                        serializeMentionLabel(
                            node.attrs as {
                                id: string;
                                label: string;
                                type: MentionEntryType;
                            }
                        ),
                    renderHTML: ({ node, options }) => {
                        const attrs = node.attrs as {
                            id: string;
                            label: string;
                            type: MentionEntryType;
                        };
                        const displayLabel = attrs.label ?? attrs.id;
                        const suffix = attrs.type === "directory" ? "/" : "";
                        return [
                            "span",
                            {
                                ...(options.HTMLAttributes ?? {}),
                                "data-id": attrs.id,
                                "data-label": displayLabel,
                                "data-type": attrs.type
                            },
                            `@${displayLabel}${suffix}`
                        ];
                    },
                    suggestion: createMentionSuggestion(
                        () => workspaceIdRef.current
                    )
                })
            ],
            [placeholder]
        );

        const editor = useEditor({
            extensions,
            editable: !disabled,
            content:
                initialContentRef.current &&
                typeof initialContentRef.current === "object"
                    ? (initialContentRef.current as Content)
                    : undefined,
            editorProps: {
                attributes: {
                    class:
                        "mention-editor-content w-full resize-none bg-transparent px-1 py-1 text-sm leading-6 text-dark-50 outline-none"
                },
                handleKeyDown: (view, event) => {
                    // ProseMirror checks view-level handleKeyDown BEFORE
                    // plugin-level ones, so we have to explicitly defer to
                    // the mention/slash suggestion plugins while either popup
                    // is open. Otherwise Enter would submit the form instead
                    // of selecting the highlighted entry.
                    const popupActive =
                        isMentionPopupOpen() ||
                        isMentionPopupActive(view.state) ||
                        isSlashPopupOpen() ||
                        isSlashPopupActive(view.state);

                    if (
                        popupActive &&
                        (event.key === "Enter" ||
                            event.key === "Tab" ||
                            event.key === "ArrowUp" ||
                            event.key === "ArrowDown")
                    ) {
                        // Stop the form's native implicit-submit path AND
                        // block our own submit handler — then let the
                        // suggestion plugin process the key.
                        event.preventDefault();
                        event.stopPropagation();
                        return false;
                    }

                    if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        onSubmitRef.current?.();
                        return true;
                    }
                    return false;
                },
                handlePaste: (_view, event) => {
                    const files = event.clipboardData?.files;
                    if (files && files.length > 0 && onPasteFilesRef.current) {
                        event.preventDefault();
                        onPasteFilesRef.current(files);
                        return true;
                    }
                    return false;
                }
            },
            onUpdate: ({ editor: ed }) => {
                onChangeRef.current?.(serializeEditor(ed));
            }
        });

        useEffect(() => {
            if (editor) {
                editor.setEditable(!disabled);
            }
        }, [editor, disabled]);

        useImperativeHandle(
            ref,
            (): MentionEditorHandle => ({
                clear: () => {
                    editor?.commands.clearContent(true);
                },
                focus: () => {
                    editor?.commands.focus();
                },
                serialize: () =>
                    editor
                        ? serializeEditor(editor)
                        : { text: "", mentions: [], slashCommandNames: [] },
                isEmpty: () => editor?.isEmpty ?? true,
                getDocJSON: () => editor?.getJSON() ?? null,
                setDocJSON: (json) => {
                    if (!editor) return;
                    if (!json || typeof json !== "object") {
                        editor.commands.clearContent(false);
                        return;
                    }
                    // emitUpdate: false suppresses onUpdate so the
                    // rehydrated content doesn't immediately echo back into
                    // the draft store on mount.
                    editor.commands.setContent(
                        json as Parameters<
                            typeof editor.commands.setContent
                        >[0],
                        { emitUpdate: false }
                    );
                },
                setPlainText: (text) => {
                    if (!editor) return;
                    if (!text || text.length === 0) {
                        editor.commands.clearContent(true);
                        return;
                    }
                    editor.commands.setContent({
                        type: "doc",
                        content: [
                            {
                                type: "paragraph",
                                content: [{ type: "text", text }]
                            }
                        ]
                    });
                    editor.commands.focus("end");
                }
            }),
            [editor]
        );

        return <EditorContent editor={editor} className={className} />;
    }
);

MentionEditor.displayName = "MentionEditor";
