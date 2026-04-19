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

export function isMentionPopupActive(state: EditorState): boolean {
    return MENTION_PLUGIN_KEY.getState(state)?.active === true;
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
            let resizeObserver: ResizeObserver | null = null;
            const listRef = createRef<MentionListHandle>();

            const positionContainer = () => {
                if (!container || !lastProps) return;
                const rect = lastProps.clientRect?.();
                if (!rect) return;

                const height = container.offsetHeight;
                const width = container.offsetWidth;
                if (height === 0) return; // wait for ResizeObserver callback

                const viewportHeight = window.innerHeight;
                const viewportWidth = window.innerWidth;

                const spaceBelow = viewportHeight - rect.bottom;
                const spaceAbove = rect.top;

                // Prefer above when there's not enough room below, which is
                // effectively always the case for a bottom-anchored chat
                // input.
                const placeAbove =
                    spaceBelow < height + ANCHOR_GAP + VIEWPORT_PADDING &&
                    spaceAbove > spaceBelow;

                const top = placeAbove
                    ? Math.max(
                          VIEWPORT_PADDING,
                          rect.top - height - ANCHOR_GAP
                      )
                    : Math.min(
                          viewportHeight - height - VIEWPORT_PADDING,
                          rect.bottom + ANCHOR_GAP
                      );

                const left = Math.min(
                    Math.max(VIEWPORT_PADDING, rect.left),
                    viewportWidth - width - VIEWPORT_PADDING
                );

                container.style.left = `${left}px`;
                container.style.top = `${top}px`;
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

                    container = document.createElement("div");
                    container.style.position = "fixed";
                    container.style.zIndex = "60";
                    container.style.left = "0px";
                    container.style.top = "0px";
                    // Hide until ResizeObserver fires so the popup doesn't
                    // flash in the wrong spot before it has a measured height.
                    container.style.visibility = "hidden";
                    document.body.appendChild(container);
                    root = createRoot(container);

                    // Repositions after every React commit that actually
                    // changes the popup's box size. This is the only reliable
                    // way to learn the height — rAF fires before React
                    // commits so offsetHeight is still 0.
                    resizeObserver = new ResizeObserver(() => {
                        positionContainer();
                    });
                    resizeObserver.observe(container);

                    window.addEventListener("resize", handleViewportChange);
                    window.addEventListener(
                        "scroll",
                        handleViewportChange,
                        true
                    );

                    renderList(props);
                },
                onUpdate: (props) => {
                    renderList(props);
                    // ResizeObserver will fire if size changes; also reposition
                    // immediately so the popup tracks the caret while typing.
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
                    resizeObserver?.disconnect();
                    resizeObserver = null;
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
