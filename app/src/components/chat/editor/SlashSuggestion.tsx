import { createRoot, type Root } from "react-dom/client";
import { createRef } from "react";
import { Extension, type Editor, type Range } from "@tiptap/core";
import { PluginKey, type EditorState } from "@tiptap/pm/state";
import {
    Suggestion,
    type SuggestionOptions,
    type SuggestionProps
} from "@tiptap/suggestion";
import type { SlashCommand } from "@/features/slash-commands";
import { SlashList, type SlashListHandle } from "./SlashList";

type SuggestionRender = NonNullable<SuggestionOptions["render"]>;
type SuggestionRenderReturn = ReturnType<SuggestionRender>;

const VIEWPORT_PADDING = 8;
const ANCHOR_GAP = 6;

interface SlashSuggestionState {
    active?: boolean;
}

export const SLASH_PLUGIN_KEY = new PluginKey<SlashSuggestionState>(
    "slash-suggestion"
);

// Module-level flag tracking whether any slash popup is currently rendered.
// Used by `ChatInput.handleSend` to swallow Enter while the popup is open
// (so Enter selects the highlighted entry rather than submitting the form).
let popupOpenCount = 0;

function setPopupOpen(open: boolean) {
    if (open) popupOpenCount += 1;
    else popupOpenCount = Math.max(0, popupOpenCount - 1);
}

export function isSlashPopupActive(state: EditorState): boolean {
    if (isSlashPopupOpen()) return true;
    return SLASH_PLUGIN_KEY.getState(state)?.active === true;
}

export function isSlashPopupOpen(): boolean {
    if (popupOpenCount > 0) return true;
    if (
        typeof document !== "undefined" &&
        document.querySelector("[data-slash-popup]")
    ) {
        return true;
    }
    return false;
}

/**
 * Replace the matched `/<query>` range with a marked `/<command>` token plus
 * a trailing space. The mark gives the token its neon-yellow styling; the
 * trailing space is intentionally NOT marked so subsequent typing renders
 * normally. This is the only way the slash command lands in the editor —
 * picking from the popup is what triggers it.
 */
function insertSlashCommand(
    editor: Editor,
    range: Range,
    cmd: SlashCommand
): void {
    const text = `/${cmd.name}`;
    editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
            type: "text",
            text,
            marks: [{ type: "slashCommand" }]
        })
        // The trailing space is unmarked so further typing isn't yellow.
        .insertContent(" ")
        .run();
}

/**
 * Decision returned from the host's `onSelectCommand` hook for a picked
 * slash command:
 *   - "insert"   → drop the marked `/<name>` token into the editor as
 *                  regular editable text (default for skill commands).
 *   - "consumed" → host already handled it (e.g. mode toggle that fires
 *                  immediately on selection); the suggestion plugin just
 *                  deletes the typed `/<query>` range without inserting.
 */
export type SlashSelectDecision = "insert" | "consumed";

function buildSuggestionConfig(): Partial<SuggestionOptions<SlashCommand>> {
    return {
        char: "/",
        allowSpaces: false,
        // Slash commands can be typed anywhere in the input — at the start
        // of a paragraph, after whitespace mid-message, etc. We require a
        // whitespace char (or start-of-doc) immediately before the trigger
        // so URL-ish text like `1/2`, `http://`, or `path/to/file` doesn't
        // accidentally pop the popover mid-word.
        startOfLine: false,
        allowedPrefixes: [" ", "\n", "\t"],
        pluginKey: SLASH_PLUGIN_KEY,
        items: ({ query }) => {
            // Items resolved inside SlashList; we just pass through.
            return [{ query }] as unknown as SlashCommand[];
        },
        command: ({ editor, range, props }) => {
            const ext = editor.extensionManager.extensions.find(
                (e) => e.name === "slashSuggestion"
            );
            const handler = (
                ext?.options as
                    | {
                          onSelectCommand?: (
                              cmd: SlashCommand
                          ) => SlashSelectDecision;
                      }
                    | undefined
            )?.onSelectCommand;
            const decision = handler?.(props) ?? "insert";

            if (decision === "consumed") {
                // Host owns the side effect (mode toggles fire immediately);
                // we just need to wipe the typed `/<query>` range so it
                // doesn't linger in the editor.
                editor.chain().focus().deleteRange(range).run();
                return;
            }

            insertSlashCommand(editor, range, props);
        },
        render: (): SuggestionRenderReturn => {
            let container: HTMLDivElement | null = null;
            let root: Root | null = null;
            let lastProps: SuggestionProps<SlashCommand> | null = null;
            const listRef = createRef<SlashListHandle>();

            const positionContainer = () => {
                if (!container || !lastProps) return;
                const rect = lastProps.clientRect?.();
                if (!rect) return;

                const width = container.offsetWidth;
                const viewportWidth = window.innerWidth;
                const viewportHeight = window.innerHeight;

                // Anchor from the bottom so the popover grows upward without
                // needing to know its own height first (mirrors mention).
                const bottom = viewportHeight - rect.top + ANCHOR_GAP;
                const left = Math.min(
                    Math.max(VIEWPORT_PADDING, rect.left),
                    viewportWidth - width - VIEWPORT_PADDING
                );

                container.style.bottom = `${bottom}px`;
                container.style.left = `${left}px`;
                if (container.style.visibility === "hidden") {
                    container.style.visibility = "visible";
                }
            };

            const renderList = (
                props: SuggestionProps<SlashCommand>,
                workspaceId: string | null
            ) => {
                if (!container || !root) return;
                lastProps = props;
                root.render(
                    <SlashList
                        ref={listRef}
                        query={props.query}
                        workspaceId={workspaceId}
                        command={(cmd) => {
                            props.command(cmd);
                        }}
                    />
                );
            };

            const handleViewportChange = () => positionContainer();

            return {
                onStart: (props) => {
                    setPopupOpen(true);
                    container = document.createElement("div");
                    container.setAttribute("data-slash-popup", "");
                    container.style.position = "fixed";
                    container.style.zIndex = "60";
                    container.style.left = "0px";
                    container.style.bottom = "0px";
                    container.style.visibility = "hidden";
                    document.body.appendChild(container);
                    root = createRoot(container);

                    window.addEventListener("resize", handleViewportChange);
                    window.addEventListener(
                        "scroll",
                        handleViewportChange,
                        true
                    );

                    const ext = props.editor.extensionManager.extensions.find(
                        (e) => e.name === "slashSuggestion"
                    );
                    const workspaceId =
                        (ext?.options as
                            | { getWorkspaceId?: () => string | null }
                            | undefined)?.getWorkspaceId?.() ?? null;

                    renderList(props, workspaceId);
                    requestAnimationFrame(() => positionContainer());
                },
                onUpdate: (props) => {
                    const ext = props.editor.extensionManager.extensions.find(
                        (e) => e.name === "slashSuggestion"
                    );
                    const workspaceId =
                        (ext?.options as
                            | { getWorkspaceId?: () => string | null }
                            | undefined)?.getWorkspaceId?.() ?? null;
                    renderList(props, workspaceId);
                    positionContainer();
                },
                onKeyDown: (props) => {
                    if (props.event.key === "Escape") {
                        return false;
                    }

                    // Always consume Enter and Tab while the popup is open
                    // so they never fall through to the editor's
                    // submit-on-Enter handler.
                    if (
                        props.event.key === "Enter" ||
                        props.event.key === "Tab"
                    ) {
                        listRef.current?.onKeyDown({ event: props.event });
                        return true;
                    }

                    return (
                        listRef.current?.onKeyDown({ event: props.event }) ??
                        false
                    );
                },
                onExit: () => {
                    setPopupOpen(false);
                    window.removeEventListener(
                        "resize",
                        handleViewportChange
                    );
                    window.removeEventListener(
                        "scroll",
                        handleViewportChange,
                        true
                    );
                    lastProps = null;

                    const r = root;
                    const c = container;
                    setTimeout(() => {
                        r?.unmount();
                        c?.remove();
                    }, 0);
                    root = null;
                    container = null;
                }
            };
        }
    };
}

interface SlashSuggestionExtensionOptions {
    getWorkspaceId: () => string | null;
    /**
     * Optional hook fired the moment the user picks a command from the
     * popup. Return `"consumed"` to suppress the default
     * insert-marked-token behavior (used for mode commands which switch
     * mode immediately and shouldn't leave any text behind). Return
     * `"insert"` (or omit the option entirely) to fall through to the
     * default skill-command insertion.
     */
    onSelectCommand?: (cmd: SlashCommand) => SlashSelectDecision;
}

/**
 * Extension that mounts the Suggestion plugin keyed on `/`. The Suggestion
 * plugin needs the live `editor` instance, which is only available after
 * the extension is created — so we attach via `addProseMirrorPlugins`.
 */
export const SlashSuggestionExtension =
    Extension.create<SlashSuggestionExtensionOptions>({
        name: "slashSuggestion",

        addOptions() {
            return {
                getWorkspaceId: () => null,
                onSelectCommand: undefined
            };
        },

        addProseMirrorPlugins() {
            return [
                Suggestion<SlashCommand>({
                    editor: this.editor,
                    ...buildSuggestionConfig()
                })
            ];
        }
    });
