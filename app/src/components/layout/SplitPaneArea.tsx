import {
    type ReactNode,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState
} from "react";
import { useNavigate } from "@tanstack/react-router";
import { ConversationPane } from "@/components/chat/ConversationPane";
import { cn } from "@/lib/cn";
import { useConversationStore } from "@/features/conversations";
import {
    MAX_PANES,
    MIN_PANE_WIDTH_PX,
    PaneScopeProvider,
    isSplitPaneDrag,
    readSplitPaneDragPayload,
    useSplitPaneStore
} from "@/features/split-panes";

interface SplitPaneAreaProps {
    /**
     * The URL-bound primary pane content. Almost always a route outlet
     * (`/`, `/conversations/$conversationId`, …) wrapped in `<main>` by the
     * AppLayout.
     */
    children: ReactNode;
}

type DragZone = "before" | "replace" | "after";

/**
 * Lays out the URL-bound primary pane plus zero, one, or two secondary
 * panes (driven by `useSplitPaneStore`) horizontally inside the main area.
 * Renders resize handles between panes and a drop overlay while a
 * conversation is being dragged from the sidebar.
 *
 * The primary pane is always `children`. Whether `children` actually
 * contains a `ConversationPane` (when on `/conversations/:id`) or some
 * other route content (e.g. `/` home) doesn't matter — secondary panes are
 * drawn alongside it either way.
 *
 * Layout is global, NOT per-workspace: each pane carries its own
 * `workspaceId`, so the user can drag a conversation from workspace A
 * next to one from workspace B and both stay visible regardless of which
 * workspace is currently "active".
 */
export function SplitPaneArea({ children }: SplitPaneAreaProps) {
    const navigate = useNavigate();

    const extraPanes = useSplitPaneStore((s) => s.extraPanes);
    const widthFractions = useSplitPaneStore((s) => s.widthFractions);
    const focusedPaneIndex = useSplitPaneStore((s) => s.focusedPaneIndex);

    const setFocusedPaneIndex = useSplitPaneStore(
        (s) => s.setFocusedPaneIndex
    );
    const setWidthFractions = useSplitPaneStore((s) => s.setWidthFractions);
    const removeSecondaryPane = useSplitPaneStore(
        (s) => s.removeSecondaryPane
    );
    const insertPaneAt = useSplitPaneStore((s) => s.insertPaneAt);
    const replaceSecondaryConversation = useSplitPaneStore(
        (s) => s.replaceSecondaryConversation
    );

    const totalPanes = extraPanes.length + 1;
    const splitActive = totalPanes > 1;
    const canAddMore = totalPanes < MAX_PANES;

    // The fractions array is the source of truth for layout — fall back to
    // an even split when nothing is persisted yet.
    const effectiveFractions = useMemo(() => {
        if (
            widthFractions &&
            widthFractions.length === totalPanes &&
            widthFractions.every((f) => Number.isFinite(f) && f > 0)
        ) {
            const sum = widthFractions.reduce((a, b) => a + b, 0);
            return widthFractions.map((f) => f / sum);
        }
        return Array.from({ length: totalPanes }, () => 1 / totalPanes);
    }, [widthFractions, totalPanes]);

    // ─── Resize ──────────────────────────────────────────────────────────
    const containerRef = useRef<HTMLDivElement>(null);
    const dragStateRef = useRef<{
        handleIndex: number;
        startX: number;
        startFractions: number[];
        containerWidth: number;
    } | null>(null);
    const [isResizing, setIsResizing] = useState(false);

    const handleResizeStart = useCallback(
        (handleIndex: number) => (e: React.PointerEvent<HTMLDivElement>) => {
            if (!containerRef.current) return;
            e.preventDefault();
            // Capture on the element the React handlers are attached to so
            // subsequent pointermove/pointerup keep firing here even when
            // the pointer leaves the thin handle's hit area.
            e.currentTarget.setPointerCapture(e.pointerId);
            dragStateRef.current = {
                handleIndex,
                startX: e.clientX,
                startFractions: effectiveFractions.slice(),
                containerWidth:
                    containerRef.current.getBoundingClientRect().width
            };
            setIsResizing(true);
        },
        [effectiveFractions]
    );

    const handleResizeMove = useCallback(
        (e: React.PointerEvent<HTMLDivElement>) => {
            const drag = dragStateRef.current;
            if (!drag) return;
            const deltaPx = e.clientX - drag.startX;
            const deltaFrac = deltaPx / drag.containerWidth;

            const next = drag.startFractions.slice();
            const left = drag.handleIndex;
            const right = drag.handleIndex + 1;
            if (right >= next.length) return;

            const minFrac = MIN_PANE_WIDTH_PX / drag.containerWidth;

            // Try moving deltaFrac from `right` to `left` (positive delta) or
            // vice versa, clamped so neither pane shrinks past minFrac.
            let appliedDelta = deltaFrac;
            if (appliedDelta > 0) {
                appliedDelta = Math.min(
                    appliedDelta,
                    Math.max(0, next[right]! - minFrac)
                );
            } else {
                appliedDelta = Math.max(
                    appliedDelta,
                    -Math.max(0, next[left]! - minFrac)
                );
            }
            next[left] = next[left]! + appliedDelta;
            next[right] = next[right]! - appliedDelta;

            setWidthFractions(next);
        },
        [setWidthFractions]
    );

    const handleResizeEnd = useCallback(
        (e: React.PointerEvent<HTMLDivElement>) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                e.currentTarget.releasePointerCapture(e.pointerId);
            }
            dragStateRef.current = null;
            setIsResizing(false);
        },
        []
    );

    // ─── Alt+<digit> pane switching ──────────────────────────────────────
    //
    // Built-in (non-configurable) shortcut for split mode: Alt+1 focuses
    // the primary pane, Alt+2 the first secondary, Alt+3 the second
    // secondary, etc. Bypasses the user-configurable `useHotkey` system on
    // purpose — the user requested this be a plain feature, not a
    // remappable binding.
    //
    // Only active while a split is actually visible; in single-pane mode
    // there's nothing to switch to and we don't want to swallow Alt+digit.
    useEffect(() => {
        if (!splitActive) return;
        const onKeyDown = (e: KeyboardEvent) => {
            if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
            // `event.code` is layout-independent ("Digit1" .. "Digit9");
            // `event.key` would be the alt-modified character on macOS
            // (e.g. "¡" for Opt+1) which wouldn't match a digit string.
            const code = e.code;
            if (!code.startsWith("Digit")) return;
            const digit = Number.parseInt(code.slice(5), 10);
            if (!Number.isFinite(digit) || digit < 1) return;
            const targetIndex = digit - 1;
            if (targetIndex >= totalPanes) return;
            e.preventDefault();
            if (focusedPaneIndex !== targetIndex) {
                setFocusedPaneIndex(targetIndex);
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [splitActive, totalPanes, focusedPaneIndex, setFocusedPaneIndex]);

    // ─── Drag-and-drop from sidebar ──────────────────────────────────────
    //
    // The drop overlay shows three zones per pane: insert-before, replace
    // this pane, insert-after. Track which zone (if any) the pointer is
    // currently over so it can light up. Because `dragenter`/`dragleave`
    // fire wildly across child elements, we count enters/leaves on the
    // container and only hide the overlay when the count drops to 0.
    const [isDragOver, setIsDragOver] = useState(false);
    const dragEnterCount = useRef(0);
    const [hoverZone, setHoverZone] = useState<{
        paneIndex: number;
        zone: DragZone;
    } | null>(null);

    useEffect(() => {
        const onDragEnd = () => {
            dragEnterCount.current = 0;
            setIsDragOver(false);
            setHoverZone(null);
        };
        document.addEventListener("dragend", onDragEnd);
        document.addEventListener("drop", onDragEnd);
        return () => {
            document.removeEventListener("dragend", onDragEnd);
            document.removeEventListener("drop", onDragEnd);
        };
    }, []);

    const handleAreaDragEnter = useCallback((e: React.DragEvent) => {
        if (!isSplitPaneDrag(e)) return;
        e.preventDefault();
        dragEnterCount.current += 1;
        setIsDragOver(true);
    }, []);

    const handleAreaDragLeave = useCallback((e: React.DragEvent) => {
        if (!isSplitPaneDrag(e)) return;
        dragEnterCount.current = Math.max(0, dragEnterCount.current - 1);
        if (dragEnterCount.current === 0) {
            setIsDragOver(false);
            setHoverZone(null);
        }
    }, []);

    const handleAreaDragOver = useCallback((e: React.DragEvent) => {
        if (!isSplitPaneDrag(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
    }, []);

    const handleZoneDragOver = useCallback(
        (paneIndex: number, zone: DragZone) =>
            (e: React.DragEvent) => {
                if (!isSplitPaneDrag(e)) return;
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = "copy";
                setHoverZone((prev) =>
                    prev?.paneIndex === paneIndex && prev.zone === zone
                        ? prev
                        : { paneIndex, zone }
                );
            },
        []
    );

    const handleZoneDrop = useCallback(
        (paneIndex: number, zone: DragZone) =>
            (e: React.DragEvent) => {
                if (!isSplitPaneDrag(e)) return;
                e.preventDefault();
                e.stopPropagation();
                const payload = readSplitPaneDragPayload(e);
                dragEnterCount.current = 0;
                setIsDragOver(false);
                setHoverZone(null);
                if (!payload) return;

                if (zone === "replace") {
                    if (paneIndex === 0) {
                        // Replacing the primary means navigating the URL.
                        // Pre-populate the conversation→workspace map so
                        // the route's load uses the right per-workspace
                        // SQLite even when the dragged conversation
                        // belongs to a different workspace than the one
                        // currently active.
                        useConversationStore
                            .getState()
                            .setConversationWorkspace(
                                payload.conversationId,
                                payload.workspaceId
                            );
                        void navigate({
                            to: "/conversations/$conversationId",
                            params: { conversationId: payload.conversationId }
                        });
                        setFocusedPaneIndex(0);
                        return;
                    }
                    replaceSecondaryConversation(
                        paneIndex,
                        payload.workspaceId,
                        payload.conversationId
                    );
                    setFocusedPaneIndex(paneIndex);
                    return;
                }

                insertPaneAt(
                    payload.workspaceId,
                    payload.conversationId,
                    paneIndex,
                    zone
                );
            },
        [
            insertPaneAt,
            navigate,
            replaceSecondaryConversation,
            setFocusedPaneIndex
        ]
    );

    // ─── Build the pane list ─────────────────────────────────────────────
    //
    // We render the primary as a flex item with `flexBasis: <fraction>%`.
    // Secondary panes are full ConversationPane instances. Resize handles
    // are placed between adjacent panes. Each pane is wrapped in a
    // `PaneScopeProvider` so deeply nested components (chat input, mode
    // selectors) can gate their hotkeys on whether their pane is focused.
    const panes: {
        key: string;
        node: ReactNode;
        index: number;
        conversationId: string | null;
        workspaceId: string | null;
    }[] = [];
    panes.push({
        key: "primary",
        index: 0,
        // We don't know the primary pane's conversationId/workspaceId at
        // this layer (the URL determines them inside `children`), so we
        // pass `null` and let nested components fall back to the
        // active-workspace selector. The pane scope's `isFocused` flag
        // is what gates hotkeys; the ids are purely informational.
        conversationId: null,
        workspaceId: null,
        node: children
    });
    extraPanes.forEach((p, i) => {
        const idx = i + 1;
        panes.push({
            key: p.id,
            index: idx,
            conversationId: p.conversationId,
            workspaceId: p.workspaceId,
            node: (
                <ConversationPane
                    workspaceId={p.workspaceId}
                    conversationId={p.conversationId}
                    isFocused={focusedPaneIndex === idx}
                    splitActive={splitActive}
                    onFocus={() => {
                        setFocusedPaneIndex(idx);
                    }}
                    onClose={() => {
                        removeSecondaryPane(idx);
                    }}
                />
            )
        });
    });

    return (
        <div
            ref={containerRef}
            className={cn(
                "relative flex h-full min-h-0 min-w-0 flex-1",
                isResizing && "select-none"
            )}
            onDragEnter={handleAreaDragEnter}
            onDragLeave={handleAreaDragLeave}
            onDragOver={handleAreaDragOver}
        >
            {panes.map((pane, paneListIdx) => {
                const isPrimary = pane.index === 0;
                const isFocused = focusedPaneIndex === pane.index;
                const fraction =
                    effectiveFractions[pane.index] ?? 1 / totalPanes;
                const isLast = paneListIdx === panes.length - 1;
                return (
                    <div key={pane.key} className="contents">
                        <div
                            className={cn(
                                "relative flex h-full min-h-0 min-w-0 flex-col",
                                splitActive && paneListIdx > 0 && "border-l border-dark-700"
                            )}
                            style={{
                                flexBasis: `${fraction * 100}%`,
                                flexGrow: 0,
                                flexShrink: 1,
                                minWidth: splitActive
                                    ? `${MIN_PANE_WIDTH_PX}px`
                                    : undefined
                            }}
                            onMouseDownCapture={() => {
                                if (focusedPaneIndex !== pane.index) {
                                    setFocusedPaneIndex(pane.index);
                                }
                            }}
                        >
                            {/* Focus accent for the primary pane only when
                                multiple panes are visible. Secondary panes
                                draw their own accent inside ConversationPane. */}
                            {splitActive && isPrimary ? (
                                <div
                                    aria-hidden
                                    className={cn(
                                        "pointer-events-none absolute inset-x-0 top-0 z-20 h-px transition-colors",
                                        isFocused
                                            ? "bg-dark-50/40"
                                            : "bg-transparent"
                                    )}
                                />
                            ) : null}

                            <PaneScopeProvider
                                isFocused={isFocused}
                                conversationId={pane.conversationId}
                                workspaceId={pane.workspaceId}
                                paneIndex={pane.index}
                            >
                                <div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col">
                                    {pane.node}
                                </div>
                            </PaneScopeProvider>

                            {isDragOver ? (
                                <DropZoneOverlay
                                    paneIndex={pane.index}
                                    canAddMore={canAddMore}
                                    isPrimary={isPrimary}
                                    isLast={isLast}
                                    hoverZone={
                                        hoverZone?.paneIndex === pane.index
                                            ? hoverZone.zone
                                            : null
                                    }
                                    onZoneDragOver={handleZoneDragOver}
                                    onZoneDrop={handleZoneDrop}
                                />
                            ) : null}
                        </div>

                        {!isLast ? (
                            <ResizeHandle
                                onPointerDown={handleResizeStart(paneListIdx)}
                                onPointerMove={handleResizeMove}
                                onPointerUp={handleResizeEnd}
                                onPointerCancel={handleResizeEnd}
                                isResizing={isResizing}
                            />
                        ) : null}
                    </div>
                );
            })}
        </div>
    );
}

interface ResizeHandleProps {
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
    onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => void;
    onPointerCancel: (e: React.PointerEvent<HTMLDivElement>) => void;
    isResizing: boolean;
}

function ResizeHandle({
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    isResizing
}: ResizeHandleProps) {
    return (
        <div
            role="separator"
            aria-orientation="vertical"
            className={cn(
                "group/resize relative z-30 -mx-1 w-2 shrink-0 cursor-col-resize select-none"
            )}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
        >
            <div
                aria-hidden
                className={cn(
                    "pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-dark-700 transition-colors",
                    "group-hover/resize:bg-dark-50/40",
                    isResizing && "bg-dark-50/60"
                )}
            />
        </div>
    );
}

interface DropZoneOverlayProps {
    paneIndex: number;
    isPrimary: boolean;
    isLast: boolean;
    canAddMore: boolean;
    hoverZone: DragZone | null;
    onZoneDragOver: (
        paneIndex: number,
        zone: DragZone
    ) => (e: React.DragEvent) => void;
    onZoneDrop: (
        paneIndex: number,
        zone: DragZone
    ) => (e: React.DragEvent) => void;
}

function DropZoneOverlay({
    paneIndex,
    isPrimary,
    isLast,
    canAddMore,
    hoverZone,
    onZoneDragOver,
    onZoneDrop
}: DropZoneOverlayProps) {
    // Zone visibility rules:
    // - "before" inserts a pane to the left of this pane. Hidden on the
    //   primary because the primary is always leftmost (URL-bound) — there
    //   is nowhere to insert "before" it.
    // - "after" inserts a pane to the right of this pane. Always shown
    //   when the cap hasn't been hit.
    // - "replace" swaps the conversation rendered by this pane. Always
    //   shown; for the primary it triggers a router navigation, otherwise
    //   it updates the store directly.
    const showBefore = canAddMore && !isPrimary;
    const showAfter = canAddMore;
    const showReplace = true;

    return (
        <div className="pointer-events-none absolute inset-0 z-40">
            <div className="pointer-events-none absolute inset-2 rounded-md border border-dashed border-dark-50/15" />
            <div className="pointer-events-auto absolute inset-0 flex">
                {showBefore ? (
                    <DropZone
                        label="Insert pane to the left"
                        active={hoverZone === "before"}
                        onDragOver={onZoneDragOver(paneIndex, "before")}
                        onDrop={onZoneDrop(paneIndex, "before")}
                    />
                ) : null}
                {showReplace ? (
                    <DropZone
                        label={
                            isPrimary
                                ? "Open here"
                                : "Replace this pane"
                        }
                        active={hoverZone === "replace"}
                        onDragOver={onZoneDragOver(paneIndex, "replace")}
                        onDrop={onZoneDrop(paneIndex, "replace")}
                        flexBasis={showBefore || showAfter ? "40%" : "100%"}
                    />
                ) : null}
                {showAfter ? (
                    <DropZone
                        label="Insert pane to the right"
                        active={hoverZone === "after"}
                        onDragOver={onZoneDragOver(paneIndex, "after")}
                        onDrop={onZoneDrop(paneIndex, "after")}
                        edge={isLast ? "right" : undefined}
                    />
                ) : null}
            </div>
        </div>
    );
}

interface DropZoneProps {
    label: string;
    active: boolean;
    onDragOver: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
    flexBasis?: string;
    edge?: "left" | "right";
}

function DropZone({
    label,
    active,
    onDragOver,
    onDrop,
    flexBasis = "30%",
    edge
}: DropZoneProps) {
    return (
        <div
            onDragOver={onDragOver}
            onDrop={onDrop}
            className={cn(
                "flex flex-1 items-center justify-center transition-colors duration-100",
                active
                    ? "bg-dark-50/10 backdrop-blur-[1px]"
                    : "bg-transparent",
                edge === "left" && "rounded-l-md",
                edge === "right" && "rounded-r-md"
            )}
            style={{ flexBasis }}
        >
            <span
                className={cn(
                    "rounded-md border px-3 py-1.5 text-[11px] font-medium transition-all duration-100",
                    active
                        ? "border-dark-50/30 bg-dark-900/85 text-dark-50 shadow-sm"
                        : "border-transparent text-transparent"
                )}
            >
                {label}
            </span>
        </div>
    );
}
