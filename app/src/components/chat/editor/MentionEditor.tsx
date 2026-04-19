import {
    forwardRef,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef
} from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import HardBreak from "@tiptap/extension-hard-break";
import { Placeholder, UndoRedo } from "@tiptap/extensions";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { MentionExtension, serializeMentionLabel } from "./MentionExtension";
import {
    createMentionSuggestion,
    isMentionPopupActive
} from "./MentionSuggestion";
import type { MentionEntryType } from "@/features/workspaces";

export interface SerializedMention {
    path: string;
    type: MentionEntryType;
}

export interface SerializedEditor {
    text: string;
    mentions: SerializedMention[];
}

export interface MentionEditorHandle {
    clear: () => void;
    focus: () => void;
    serialize: () => SerializedEditor;
    isEmpty: () => boolean;
}

interface MentionEditorProps {
    workspaceId: string | null | undefined;
    placeholder?: string;
    disabled?: boolean;
    onSubmit: () => void;
    onChange?: (serialized: SerializedEditor) => void;
    onPasteFiles?: (files: FileList) => void;
    className?: string;
}

function serializeEditor(editor: Editor): SerializedEditor {
    const mentions: SerializedMention[] = [];
    let text = "";
    let firstBlock = true;

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
                return;
            }
            if (node.type.name === "hardBreak") {
                text += "\n";
                return;
            }
            if (node.isText) {
                text += node.text ?? "";
                return;
            }
            node.forEach(walk);
        };

        block.forEach(walk);
    });

    return { text, mentions };
}

export const MentionEditor = forwardRef<MentionEditorHandle, MentionEditorProps>(
    (
        {
            workspaceId,
            placeholder = "Ask anything...",
            disabled,
            onSubmit,
            onChange,
            onPasteFiles,
            className
        },
        ref
    ) => {
        const workspaceIdRef = useRef<string | null>(workspaceId ?? null);
        const onSubmitRef = useRef(onSubmit);
        const onChangeRef = useRef(onChange);
        const onPasteFilesRef = useRef(onPasteFiles);

        useEffect(() => {
            workspaceIdRef.current = workspaceId ?? null;
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

        const extensions = useMemo(
            () => [
                Document,
                Paragraph,
                Text,
                HardBreak,
                UndoRedo,
                Placeholder.configure({ placeholder }),
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
            editorProps: {
                attributes: {
                    class:
                        "mention-editor-content w-full resize-none bg-transparent px-1 py-1 text-sm leading-6 text-dark-50 outline-none"
                },
                handleKeyDown: (view, event) => {
                    // ProseMirror checks view-level handleKeyDown BEFORE
                    // plugin-level ones, so we have to explicitly defer to the
                    // mention suggestion plugin while its popup is open.
                    // Otherwise Enter would submit the form instead of
                    // selecting the highlighted entry.
                    if (
                        (event.key === "Enter" ||
                            event.key === "Tab" ||
                            event.key === "ArrowUp" ||
                            event.key === "ArrowDown") &&
                        isMentionPopupActive(view.state)
                    ) {
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
                        : { text: "", mentions: [] },
                isEmpty: () => editor?.isEmpty ?? true
            }),
            [editor]
        );

        return <EditorContent editor={editor} className={className} />;
    }
);

MentionEditor.displayName = "MentionEditor";
