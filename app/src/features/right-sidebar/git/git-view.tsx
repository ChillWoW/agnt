import {
    useEffect,
    useMemo,
    useRef,
    type KeyboardEvent
} from "react";
import TextareaAutosize from "react-textarea-autosize";
import {
    ArrowsClockwiseIcon,
    ArrowDownIcon,
    ArrowUpIcon,
    CheckIcon,
    GitBranchIcon,
    MinusIcon,
    PlusIcon,
    TrashIcon,
    WarningOctagonIcon,
    XIcon
} from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui";
import { Tooltip } from "@/components/ui/Tooltip";
import { useWorkspaceStore } from "@/features/workspaces";
import { PierreDiff } from "@/components/chat/PierreDiff";
import { getFileIcon } from "../filetree/file-icon";
import {
    selectSelectedChange,
    rowKey,
    useGitStore,
    type GitRowKey
} from "./git-store";
import type { GitChangeKind, GitFileChange, GitStatus } from "./git-types";

const POLL_INTERVAL_MS = 6_000;

// ─── GitView root ────────────────────────────────────────────────────────────

export function GitView() {
    const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
    const setWorkspace = useGitStore((s) => s.setWorkspace);
    const refresh = useGitStore((s) => s.refresh);
    const status = useGitStore((s) => s.status);
    const statusLoading = useGitStore((s) => s.statusLoading);
    const statusError = useGitStore((s) => s.statusError);
    const selected = useGitStore((s) => s.selected);

    useEffect(() => {
        setWorkspace(activeWorkspaceId);
    }, [activeWorkspaceId, setWorkspace]);

    useEffect(() => {
        if (!activeWorkspaceId) return;
        const onFocus = () => void refresh();
        window.addEventListener("focus", onFocus);
        const intervalId = window.setInterval(() => {
            void refresh();
        }, POLL_INTERVAL_MS);
        return () => {
            window.removeEventListener("focus", onFocus);
            window.clearInterval(intervalId);
        };
    }, [activeWorkspaceId, refresh]);

    if (!activeWorkspaceId) {
        return (
            <PlaceholderState>
                <span>No workspace open</span>
            </PlaceholderState>
        );
    }

    if (statusLoading && !status) {
        return (
            <PlaceholderState>
                <span className="wave-text">Reading repository…</span>
            </PlaceholderState>
        );
    }

    if (statusError && !status) {
        return (
            <PlaceholderState>
                <WarningOctagonIcon className="size-5 text-red-400/80" />
                <p className="max-w-[16rem] text-center text-[12px] text-red-300/80">
                    {statusError}
                </p>
                <Button variant="ghost" size="sm" onClick={() => void refresh()}>
                    Retry
                </Button>
            </PlaceholderState>
        );
    }

    if (status && !status.isRepo) {
        return (
            <PlaceholderState>
                <GitBranchIcon className="size-5 text-dark-300" />
                <p className="max-w-[18rem] text-center text-[12px] text-dark-200">
                    This workspace isn&apos;t a git repository.
                </p>
                <span className="text-[11px] text-dark-400">
                    Run{" "}
                    <span className="rounded bg-dark-800 px-1.5 py-0.5 text-dark-100">
                        git init
                    </span>{" "}
                    in a terminal to start tracking changes.
                </span>
            </PlaceholderState>
        );
    }

    if (!status) return null;

    const showDiff = selected !== null;

    // `min-w-0` is critical at every level of this nested flex chain.
    // Without it, a single long line inside the Pierre diff would set the
    // intrinsic min-width of the diff column, which then propagates up and
    // pushes the entire git tab past the sidebar's right edge instead of
    // letting the diff scroll horizontally inside its own container.
    return (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <BranchHeader status={status} />
            <CommitPanel status={status} />
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <ChangesList status={status} />
                {showDiff && <DiffPanel />}
            </div>
        </div>
    );
}

// ─── Branch header ───────────────────────────────────────────────────────────

function BranchHeader({ status }: { status: GitStatus }) {
    const refresh = useGitStore((s) => s.refresh);
    const statusLoading = useGitStore((s) => s.statusLoading);

    const totalChanges =
        status.staged.length +
        status.unstaged.length +
        status.untracked.length +
        status.conflicted.length;

    const branchLabel = status.branch.branch
        ? status.branch.branch
        : status.branch.detachedHead
        ? `(detached) ${status.branch.detachedHead}`
        : "(no branch)";

    return (
        <div className="flex h-8 shrink-0 items-center gap-2 border-b border-dark-700 pl-3 pr-1">
            <GitBranchIcon className="size-3.5 shrink-0 text-dark-200" />

            <div className="flex min-w-0 flex-1 items-center gap-1.5">
                <span
                    className="truncate text-[12px] font-medium text-dark-50"
                    title={
                        status.branch.upstream
                            ? `${branchLabel} → ${status.branch.upstream}`
                            : branchLabel
                    }
                >
                    {branchLabel}
                </span>

                {(status.branch.ahead > 0 || status.branch.behind > 0) && (
                    <div className="flex shrink-0 items-center gap-1.5 text-[11px] text-dark-200">
                        {status.branch.ahead > 0 && (
                            <span
                                className="inline-flex items-center gap-0.5"
                                title={`${status.branch.ahead} commit${status.branch.ahead === 1 ? "" : "s"} ahead`}
                            >
                                <ArrowUpIcon
                                    className="size-2.5"
                                    weight="bold"
                                />
                                {status.branch.ahead}
                            </span>
                        )}
                        {status.branch.behind > 0 && (
                            <span
                                className="inline-flex items-center gap-0.5"
                                title={`${status.branch.behind} commit${status.branch.behind === 1 ? "" : "s"} behind`}
                            >
                                <ArrowDownIcon
                                    className="size-2.5"
                                    weight="bold"
                                />
                                {status.branch.behind}
                            </span>
                        )}
                    </div>
                )}
            </div>

            {totalChanges === 0 && !statusLoading && (
                <span
                    className="shrink-0 text-[11px] text-dark-300"
                    title="Working tree clean"
                >
                    clean
                </span>
            )}

            <Tooltip content="Refresh" side="bottom" sideOffset={6}>
                <button
                    type="button"
                    onClick={() => void refresh()}
                    disabled={statusLoading}
                    className={cn(
                        "flex size-6 shrink-0 items-center justify-center rounded text-dark-300 transition-colors hover:bg-dark-800 hover:text-dark-100",
                        "disabled:opacity-50 disabled:cursor-default"
                    )}
                >
                    <ArrowsClockwiseIcon
                        className={cn(
                            "size-3.5",
                            statusLoading && "animate-spin"
                        )}
                        weight="bold"
                    />
                </button>
            </Tooltip>
        </div>
    );
}

// ─── Commit panel ────────────────────────────────────────────────────────────

function CommitPanel({ status }: { status: GitStatus }) {
    const commitMessage = useGitStore((s) => s.commitMessage);
    const setCommitMessage = useGitStore((s) => s.setCommitMessage);
    const commit = useGitStore((s) => s.commit);
    const pendingAction = useGitStore((s) => s.pendingAction);

    const stagedCount = status.staged.length;
    const trimmed = commitMessage.trim();
    const canCommit =
        stagedCount > 0 && trimmed.length > 0 && pendingAction !== "commit";

    const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            if (canCommit) void commit();
        }
    };

    const buttonLabel = useMemo(() => {
        if (pendingAction === "commit") return "Committing…";
        return "Commit";
    }, [pendingAction]);

    const stagedHint = useMemo(() => {
        if (stagedCount === 0) return "Nothing staged yet";
        return `${stagedCount} file${stagedCount === 1 ? "" : "s"} staged`;
    }, [stagedCount]);

    return (
        <div className="flex shrink-0 flex-col gap-1.5 border-b border-dark-700 px-3 py-2.5">
            <div
                className={cn(
                    "rounded-md border border-dark-700 bg-dark-900 transition-colors",
                    "focus-within:border-dark-500"
                )}
            >
                <TextareaAutosize
                    value={commitMessage}
                    onChange={(event) => setCommitMessage(event.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Describe your changes…"
                    spellCheck={false}
                    minRows={2}
                    maxRows={6}
                    className={cn(
                        "block w-full resize-none bg-transparent px-3 py-2",
                        "text-[12.5px] leading-relaxed text-dark-50",
                        "placeholder:text-dark-400 outline-none"
                    )}
                />
            </div>
            <div className="flex items-center justify-between gap-2">
                <span
                    className="min-w-0 truncate text-[10.5px] text-dark-400"
                    title={stagedHint}
                >
                    {stagedHint}
                </span>
                <Button
                    variant={canCommit ? "primary" : "secondary"}
                    size="sm"
                    onClick={() => void commit()}
                    disabled={!canCommit}
                    loading={pendingAction === "commit"}
                    className="h-7 shrink-0 px-2.5 text-[11.5px]"
                >
                    <CheckIcon size={12} weight="bold" />
                    {buttonLabel}
                </Button>
            </div>
        </div>
    );
}

// ─── Changes list ────────────────────────────────────────────────────────────

function ChangesList({ status }: { status: GitStatus }) {
    const stageAll = useGitStore((s) => s.stageAll);
    const unstageAll = useGitStore((s) => s.unstageAll);
    const pendingAction = useGitStore((s) => s.pendingAction);

    const totalChanges =
        status.staged.length +
        status.unstaged.length +
        status.untracked.length +
        status.conflicted.length;

    if (totalChanges === 0) {
        return (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 py-10 text-[12px] text-dark-300">
                <CheckIcon className="size-5 text-emerald-400/70" weight="bold" />
                <span>No changes — your working tree is clean.</span>
            </div>
        );
    }

    return (
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
            {status.conflicted.length > 0 && (
                <ChangesSection
                    title="Conflicts"
                    accent="conflict"
                    items={status.conflicted}
                />
            )}
            {status.staged.length > 0 && (
                <ChangesSection
                    title="Staged"
                    accent="staged"
                    items={status.staged}
                    action={{
                        label: "Unstage all",
                        loading: pendingAction === "unstage-all",
                        disabled: pendingAction !== null,
                        onClick: () => void unstageAll()
                    }}
                />
            )}
            {(status.unstaged.length > 0 || status.untracked.length > 0) && (
                <ChangesSection
                    title="Changes"
                    accent="changes"
                    items={[...status.unstaged, ...status.untracked]}
                    action={{
                        label: "Stage all",
                        loading: pendingAction === "stage-all",
                        disabled: pendingAction !== null,
                        onClick: () => void stageAll()
                    }}
                />
            )}
        </div>
    );
}

interface SectionAction {
    label: string;
    onClick: () => void;
    loading: boolean;
    disabled: boolean;
}

function ChangesSection({
    title,
    accent,
    items,
    action
}: {
    title: string;
    accent: "staged" | "changes" | "conflict";
    items: GitFileChange[];
    action?: SectionAction;
}) {
    const accentDot =
        accent === "staged"
            ? "bg-emerald-400/80"
            : accent === "conflict"
              ? "bg-red-400/90"
              : "bg-dark-300";

    return (
        <div className="flex min-w-0 flex-col">
            <div className="group/section sticky top-0 z-10 flex h-7 min-w-0 items-center gap-2 border-b border-dark-800 bg-dark-950/95 pl-3 pr-1 backdrop-blur-sm">
                <span
                    aria-hidden
                    className={cn("size-1.5 shrink-0 rounded-full", accentDot)}
                />
                <span className="text-[11px] font-medium text-dark-100">
                    {title}
                </span>
                <span className="text-[11px] text-dark-400 tabular-nums">
                    {items.length}
                </span>
                <div className="min-w-0 flex-1" />
                {action && (
                    <button
                        type="button"
                        onClick={action.onClick}
                        disabled={action.disabled}
                        className={cn(
                            "rounded px-1.5 py-0.5 text-[11px] transition-colors",
                            "text-dark-400 hover:bg-dark-800 hover:text-dark-100",
                            "opacity-0 group-hover/section:opacity-100 focus-visible:opacity-100",
                            action.loading && "opacity-100",
                            "disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-dark-400"
                        )}
                    >
                        {action.loading ? "Working…" : action.label}
                    </button>
                )}
            </div>
            <div className="flex flex-col">
                {items.map((item) => (
                    <FileRow key={rowKey(item)} change={item} />
                ))}
            </div>
        </div>
    );
}

// ─── Per-file row ────────────────────────────────────────────────────────────

const KIND_LABEL: Record<GitChangeKind, string> = {
    modified: "Modified",
    added: "Added",
    deleted: "Deleted",
    renamed: "Renamed",
    copied: "Copied",
    "type-changed": "Type changed",
    untracked: "Untracked",
    conflicted: "Conflicted"
};

const KIND_BADGE: Record<GitChangeKind, string> = {
    modified: "M",
    added: "A",
    deleted: "D",
    renamed: "R",
    copied: "C",
    "type-changed": "T",
    untracked: "U",
    conflicted: "!"
};

// Tone-matched, slightly desaturated kind colors. The palette is intentionally
// quiet — change-state should be readable at a glance but never compete with
// the filename and dim path text for visual weight.
const KIND_COLOR: Record<GitChangeKind, string> = {
    modified: "text-amber-300/70",
    added: "text-emerald-300/70",
    deleted: "text-rose-300/70",
    renamed: "text-violet-300/70",
    copied: "text-violet-300/70",
    "type-changed": "text-amber-300/70",
    untracked: "text-sky-300/70",
    conflicted: "text-red-300/90"
};

function splitDisplayPath(path: string): { parent: string; name: string } {
    const normalized = path.replace(/\\/g, "/");
    const idx = normalized.lastIndexOf("/");
    if (idx < 0) return { parent: "", name: normalized };
    return {
        parent: normalized.slice(0, idx + 1),
        name: normalized.slice(idx + 1)
    };
}

function FileRow({ change }: { change: GitFileChange }) {
    const select = useGitStore((s) => s.select);
    const stage = useGitStore((s) => s.stage);
    const unstage = useGitStore((s) => s.unstage);
    const discard = useGitStore((s) => s.discard);
    const loadDiff = useGitStore((s) => s.loadDiff);
    const isSelected = useGitStore(
        (s) =>
            s.selected !== null &&
            s.selected.path === change.path &&
            s.selected.side === change.side
    );
    const busy = useGitStore((s) => s.busyKeys[rowKey(change)] === true);

    const { parent, name } = splitDisplayPath(change.path);
    const FileGlyph = getFileIcon(name);
    const isStaged = change.side === "staged";

    const handleClick = () => {
        const next = isSelected
            ? null
            : { path: change.path, side: change.side };
        select(next);
        if (!isSelected) void loadDiff(change);
    };

    const handleStageToggle = (event: React.MouseEvent) => {
        event.stopPropagation();
        if (busy) return;
        if (isStaged) void unstage(change);
        else void stage(change);
    };

    const handleDiscard = (event: React.MouseEvent) => {
        event.stopPropagation();
        if (busy) return;
        if (
            !window.confirm(
                `Discard changes to ${change.path}? This cannot be undone.`
            )
        ) {
            return;
        }
        void discard(change);
    };

    const additions = change.additions ?? null;
    const deletions = change.deletions ?? null;
    const showCounts =
        !change.binary && (additions !== null || deletions !== null);

    return (
        <div
            className={cn(
                "group/row relative flex min-w-0 w-full items-center transition-colors",
                "hover:bg-dark-850",
                isSelected && "bg-dark-850"
            )}
        >
            {isSelected && (
                <span
                    aria-hidden
                    className="pointer-events-none absolute left-0 top-0 h-full w-[2px] bg-primary-100"
                />
            )}

            <button
                type="button"
                onClick={handleClick}
                title={`${KIND_LABEL[change.kind]} · ${change.path}`}
                className="flex min-w-0 w-full items-center gap-2 py-1.5 pl-3 pr-1.5 text-left"
            >
                <span
                    className={cn(
                        "flex size-4 shrink-0 items-center justify-center text-[10px] font-semibold",
                        KIND_COLOR[change.kind]
                    )}
                    aria-label={KIND_LABEL[change.kind]}
                >
                    {KIND_BADGE[change.kind]}
                </span>

                <FileGlyph className="size-3.5 shrink-0 text-dark-200" />

                <span
                    className="min-w-0 flex-1 truncate text-left"
                    dir="ltr"
                >
                    <span
                        className={cn(
                            "text-[12px] font-medium",
                            isSelected ? "text-dark-50" : "text-dark-100",
                            change.kind === "deleted" &&
                                "line-through text-dark-200"
                        )}
                    >
                        {name}
                    </span>
                    {parent.length > 0 && (
                        <span className="ml-1.5 text-[11px] text-dark-400">
                            {parent.replace(/\/$/, "")}
                        </span>
                    )}
                </span>

                {showCounts && (
                    <span
                        className={cn(
                            "flex shrink-0 items-baseline gap-1.5 text-[10.5px] tabular-nums leading-none transition-opacity",
                            "group-hover/row:opacity-0"
                        )}
                    >
                        {additions !== null && additions > 0 && (
                            <span className="text-emerald-400/70">
                                +{additions}
                            </span>
                        )}
                        {deletions !== null && deletions > 0 && (
                            <span className="text-rose-400/70">
                                −{deletions}
                            </span>
                        )}
                    </span>
                )}

                {change.binary && (
                    <span className="shrink-0 text-[10px] uppercase tracking-wide text-dark-400 transition-opacity group-hover/row:opacity-0">
                        bin
                    </span>
                )}
            </button>

            {/* Hover overlay sits on top of the row button. We use
                `pointer-events-none` on the container so clicks in the
                empty gap between actions still fall through to the
                primary row button below, while each action button
                opts back in with `pointer-events-auto`. */}
            <span
                className={cn(
                    "pointer-events-none absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5",
                    "opacity-0 transition-opacity group-hover/row:opacity-100",
                    busy && "opacity-100"
                )}
            >
                {!isStaged && change.kind !== "conflicted" && (
                    <RowAction
                        title="Discard changes"
                        onClick={handleDiscard}
                        disabled={busy}
                    >
                        <TrashIcon className="size-3" weight="bold" />
                    </RowAction>
                )}
                <RowAction
                    title={isStaged ? "Unstage" : "Stage"}
                    onClick={handleStageToggle}
                    disabled={busy}
                    accent={isStaged ? "neutral" : "primary"}
                >
                    {isStaged ? (
                        <MinusIcon className="size-3" weight="bold" />
                    ) : (
                        <PlusIcon className="size-3" weight="bold" />
                    )}
                </RowAction>
            </span>
        </div>
    );
}

function RowAction({
    title,
    onClick,
    disabled,
    accent = "neutral",
    children
}: {
    title: string;
    onClick: (event: React.MouseEvent) => void;
    disabled?: boolean;
    accent?: "primary" | "neutral";
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            title={title}
            aria-label={title}
            className={cn(
                // Re-enable pointer events; the parent overlay opts out so
                // empty gaps stay click-through to the underlying row.
                "pointer-events-auto flex size-5 items-center justify-center rounded transition-colors",
                accent === "primary"
                    ? "text-dark-100 hover:bg-primary-100 hover:text-dark-950"
                    : "text-dark-300 hover:bg-dark-700 hover:text-dark-50",
                "disabled:cursor-default disabled:opacity-50"
            )}
        >
            {children}
        </button>
    );
}

// ─── Diff panel (selected file) ──────────────────────────────────────────────

function DiffPanel() {
    const selected = useGitStore((s) => s.selected);
    const status = useGitStore((s) => s.status);
    const change = useMemo(
        () => selectSelectedChange({ status, selected }),
        [status, selected]
    );
    const diffEntry = useGitStore((s) =>
        change ? s.diffs[rowKey(change)] : undefined
    );
    const select = useGitStore((s) => s.select);
    const loadDiff = useGitStore((s) => s.loadDiff);

    // Auto-trigger a load if we have a selection but no diff cached yet.
    const lastLoadKey = useRef<GitRowKey | null>(null);
    useEffect(() => {
        if (!change) {
            lastLoadKey.current = null;
            return;
        }
        const key = rowKey(change);
        if (
            (!diffEntry || (diffEntry.diff === null && !diffEntry.loading)) &&
            lastLoadKey.current !== key
        ) {
            lastLoadKey.current = key;
            void loadDiff(change);
        }
    }, [change, diffEntry, loadDiff]);

    if (!change) return null;

    const onClose = () => {
        select(null);
        lastLoadKey.current = null;
    };

    return (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-t border-dark-700">
            <DiffHeader change={change} onClose={onClose} />
            <DiffBody change={change} entry={diffEntry} />
        </div>
    );
}

function DiffHeader({
    change,
    onClose
}: {
    change: GitFileChange;
    onClose: () => void;
}) {
    // Intentionally minimal — just a kind chip + close button. PierreDiff's
    // own sticky header already shows the filename, parent path, and +N/-M
    // counts inside the diff body, so duplicating any of that here would
    // just waste vertical space.
    return (
        <div className="flex h-7 shrink-0 items-center gap-2 border-b border-dark-700 bg-dark-900 pl-3 pr-1">
            <span
                aria-hidden
                className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    change.kind === "modified" && "bg-amber-400/70",
                    change.kind === "added" && "bg-emerald-400/70",
                    change.kind === "deleted" && "bg-rose-400/70",
                    (change.kind === "renamed" || change.kind === "copied") &&
                        "bg-violet-400/70",
                    change.kind === "type-changed" && "bg-amber-400/70",
                    change.kind === "untracked" && "bg-sky-400/70",
                    change.kind === "conflicted" && "bg-red-400/90"
                )}
            />
            <span className="text-[11px] font-medium text-dark-100">
                {KIND_LABEL[change.kind]}
            </span>
            <span className="text-[11px] text-dark-400">
                ·{" "}
                {change.side === "staged"
                    ? "staged"
                    : change.kind === "untracked"
                      ? "new file"
                      : "working tree"}
            </span>
            <div className="min-w-0 flex-1" />
            <button
                type="button"
                onClick={onClose}
                aria-label="Close diff"
                className="flex size-5 shrink-0 items-center justify-center rounded text-dark-300 transition-colors hover:bg-dark-700 hover:text-dark-50"
            >
                <XIcon className="size-3" weight="bold" />
            </button>
        </div>
    );
}

function DiffBody({
    change,
    entry
}: {
    change: GitFileChange;
    entry: { diff: import("./git-types").GitFileDiff | null; loading: boolean; error: string | null } | undefined;
}) {
    if (!entry || (entry.loading && !entry.diff)) {
        return (
            <PlaceholderState>
                <span className="wave-text">Loading diff…</span>
            </PlaceholderState>
        );
    }

    if (entry.error && !entry.diff) {
        return (
            <PlaceholderState>
                <WarningOctagonIcon className="size-5 text-red-400/80" />
                <span className="text-[12px] text-red-300/80">
                    {entry.error}
                </span>
            </PlaceholderState>
        );
    }

    const diff = entry.diff;
    if (!diff) return null;

    if (diff.binary) {
        return (
            <PlaceholderState>
                <span className="text-[12px] text-dark-300">
                    Binary file — diff preview not available.
                </span>
            </PlaceholderState>
        );
    }

    const sameContent =
        diff.oldContents.length === 0 && diff.newContents.length === 0;
    if (sameContent) {
        return (
            <PlaceholderState>
                <span className="text-[12px] text-dark-300">
                    No textual changes detected for this side.
                </span>
            </PlaceholderState>
        );
    }

    // PierreDiff defaults to `rounded-md border border-dark-700`. We undo
    // both via tailwind-merge so the diff sits flush inside our diff panel
    // (which already provides the `border-t` separator from the changes
    // list above) — no nested "card-in-card" frame.
    return (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <PierreDiff
                path={change.path}
                oldContents={diff.oldContents}
                newContents={diff.newContents}
                maxHeightClass="h-full"
                className="w-full min-w-0 rounded-none border-0"
            />
        </div>
    );
}

// ─── Misc helpers ────────────────────────────────────────────────────────────

function PlaceholderState({ children }: { children: React.ReactNode }) {
    return (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-center text-dark-300 select-none">
            {children}
        </div>
    );
}

