import { createRoot, type Root } from "react-dom/client";
import { createRef } from "react";
import { PluginKey, type EditorState } from "@tiptap/pm/state";
import type { SuggestionOptions, SuggestionProps } from "@tiptap/suggestion";
import { MentionList, type MentionListHandle } from "./MentionList";

type SuggestionRender = NonNullable<SuggestionOptions["render"]>;
type SuggestionRenderReturn = ReturnType<SuggestionRender>;

const VIEWPORT_PADDING = 8;
const ANCHOR_GAP = 6;

/**
 * Exposed so the editor's `editorProps.handleKeyDown` can inspect the
 * suggestion's own state and bail out of the submit-on-Enter behavior while
 * the mention popup is open. ProseMirror checks the view-level
 * `handleKeyDown` BEFORE plugin-level ones, so we cannot rely on the
 * suggestion plugin to eat the Enter key on its own.
 */
interface MentionSuggestionState {
    active?: boolean;
}

export const MENTION_PLUGIN_KEY = new PluginKey<MentionSuggestionState>(
    "mention-suggestion"
);

// Module-level flag tracking whether any mention popup is currently rendered.
// Using this alongside the plugin-state check because the plugin state can
// momentarily disagree with what the user sees on screen (e.g. between the
// plugin dispatching an exit transaction and React tearing the popup down),
// and we must NEVER submit the form while the popup is visible.
let popupOpenCount = 0;

function setPopupOpen(open: boolean) {
    if (open) popupOpenCount += 1;
    else popupOpenCount = Math.max(0, popupOpenCount - 1);
}

export function isMentionPopupActive(state: EditorState): boolean {
    if (isMentionPopupOpen()) return true;
    return MENTION_PLUGIN_KEY.getState(state)?.active === true;
}

/**
 * Can be called without an EditorState — uses the module-level flag plus a
 * DOM query as a last-resort gate for callers outside the editor (e.g. form
 * submit handlers) that need to know whether the user is mid-selection.
 */
export function isMentionPopupOpen(): boolean {
    if (popupOpenCount > 0) return true;
    if (
        typeof document !== "undefined" &&
        document.querySelector("[data-mention-popup]")
    ) {
        return true;
    }
    return false;
}

export function createMentionSuggestion(
    getWorkspaceId: () => string | null | undefined
): Partial<SuggestionOptions> {
    return {
        char: "@",
        allowSpaces: false,
        startOfLine: false,
        pluginKey: MENTION_PLUGIN_KEY,
        items: ({ query }) => {
            // Items are fetched inside MentionList; we just pass through.
            return [{ query }] as unknown as never[];
        },
        render: (): SuggestionRenderReturn => {
            let container: HTMLDivElement | null = null;
            let root: Root | null = null;
            let lastProps: SuggestionProps | null = null;
            const listRef = createRef<MentionListHandle>();

            const positionContainer = () => {
                if (!container || !lastProps) return;
                const rect = lastProps.clientRect?.();
                if (!rect) return;

                const width = container.offsetWidth;
                const viewportWidth = window.innerWidth;
                const viewportHeight = window.innerHeight;

                // Anchor from the bottom so the popover grows upward without
                // needing to know its own height first.
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

            const renderList = (props: SuggestionProps) => {
                const workspaceId = getWorkspaceId();
                if (!container || !root || !workspaceId) return;
                lastProps = props;
                root.render(
                    <MentionList
                        ref={listRef}
                        query={props.query}
                        workspaceId={workspaceId}
                        command={(attrs) => {
                            props.command(attrs);
                        }}
                    />
                );
            };

            const handleViewportChange = () => positionContainer();

            return {
                onStart: (props) => {
                    const workspaceId = getWorkspaceId();
                    if (!workspaceId) return;

                    setPopupOpen(true);
                    container = document.createElement("div");
                    container.setAttribute("data-mention-popup", "");
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

                    renderList(props);
                    // rAF lets React commit before we measure offsetWidth for left.
                    requestAnimationFrame(() => positionContainer());
                },
                onUpdate: (props) => {
                    renderList(props);
                    positionContainer();
                },
                onKeyDown: (props) => {
                    if (props.event.key === "Escape") {
                        return false;
                    }

                    // Always consume Enter and Tab while the popup is open so
                    // they never fall through to the editor's submit-on-Enter
                    // handler. (Belt-and-braces — the editor also checks the
                    // plugin state, but this catches the case where no entry
                    // is selected yet.)
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

                    // Defer unmount to avoid "synchronously unmount" warning.
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
