import { useState, useEffect, useMemo, useRef } from "react";
import Anser from "anser";
import { Link } from "@tanstack/react-router";
import {
    ArrowSquareOutIcon,
    BookOpenTextIcon,
    CaretRightIcon,
    ChatTeardropDotsIcon,
    DownloadSimpleIcon,
    FileTextIcon,
    FilesIcon,
    GlobeHemisphereWestIcon,
    HourglassMediumIcon,
    ImageIcon,
    ListChecksIcon,
    GitDiffIcon,
    MagnifyingGlassIcon,
    NotepadIcon,
    NotePencilIcon,
    PencilLineIcon,
    RobotIcon,
    TerminalWindowIcon,
    WrenchIcon
} from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import type {
    ShellStreamChunk,
    ShellStreamState,
    SubagentType,
    ToolInvocation,
    ToolInvocationStatus
} from "@/features/conversations/conversation-types";
import { useWorkspaceStore } from "@/features/workspaces";
import { useConversationStore } from "@/features/conversations/conversation-store";
import { resolveAttachmentContentUrl } from "@/features/attachments";
import { PierreDiff } from "@/components/chat/PierreDiff";

// ─── Universal primitive ──────────────────────────────────────────────────────

interface ToolBlockProps {
    icon: React.ReactNode;
    pendingLabel: string;
    successLabel: string;
    errorLabel?: string;
    deniedLabel?: string;
    detail?: string;
    error?: string | null;
    status: ToolInvocationStatus;
    children?: React.ReactNode;
    autoOpen?: boolean;
    autoClose?: boolean;
    // When true, the expanded children are rendered directly (without the
    // default `max-h-48 overflow-y-auto` wrapper) so the child can own its
    // own scroll container — required for sticky headers inside the child.
    bareChildren?: boolean;
}

type ToolBlockState = "pending" | "success" | "error" | "denied";

function isPermissionDeniedError(error: string | null | undefined): boolean {
    if (!error) {
        return false;
    }

    return /(denied permission|disabled in settings|always deny|denied to run tool)/i.test(
        error
    );
}

function resolveToolBlockState(
    status: ToolInvocationStatus,
    error: string | null | undefined
): ToolBlockState {
    if (status === "pending") {
        return "pending";
    }

    if (status === "success") {
        return "success";
    }

    return isPermissionDeniedError(error) ? "denied" : "error";
}

export function ToolBlock({
    icon,
    pendingLabel,
    successLabel,
    errorLabel,
    deniedLabel,
    detail,
    error,
    status,
    children,
    autoOpen,
    autoClose,
    bareChildren
}: ToolBlockProps) {
    const state = resolveToolBlockState(status, error);
    const isPending = state === "pending";
    const isErrorState = state === "error" || state === "denied";
    const label =
        state === "pending"
            ? pendingLabel
            : state === "success"
              ? successLabel
              : state === "denied"
                ? (deniedLabel ?? errorLabel ?? successLabel)
                : (errorLabel ?? successLabel);
    const hasDropdown = !!children;

    const [expanded, setExpanded] = useState(() => !!(autoOpen && isPending));
    const prevPendingRef = useRef(isPending);
    const prevStateRef = useRef(state);

    useEffect(() => {
        const wasPending = prevPendingRef.current;
        prevPendingRef.current = isPending;

        if (isPending && !wasPending && autoOpen) {
            setExpanded(true);
        } else if (!isPending && wasPending && autoClose) {
            setExpanded(false);
        }
    }, [isPending, autoOpen, autoClose]);

    useEffect(() => {
        const previousState = prevStateRef.current;
        prevStateRef.current = state;

        if (hasDropdown && isErrorState && previousState !== state) {
            setExpanded(true);
        }
    }, [hasDropdown, isErrorState, state]);

    return (
        <div className="mb-2">
            <button
                type="button"
                onClick={() =>
                    hasDropdown && !isPending && setExpanded((v) => !v)
                }
                className={cn(
                    "flex items-center gap-1 text-xs transition-colors",
                    hasDropdown && !isPending
                        ? "cursor-pointer text-dark-200 hover:text-dark-200"
                        : "cursor-default text-dark-200"
                )}
            >
                <div className="flex items-center gap-1.5">
                    <span className="size-3.5 shrink-0 text-dark-200">
                        {icon}
                    </span>
                    <span
                        className={cn(
                            isPending
                                ? "wave-text"
                                : "text-dark-200 font-medium"
                        )}
                    >
                        {label}
                    </span>
                </div>
                {detail && (
                    <span className="min-w-0 truncate text-dark-200">
                        {detail}
                    </span>
                )}
                {hasDropdown && !isPending && (
                    <CaretRightIcon
                        className={cn(
                            "size-3 shrink-0 transition-transform",
                            expanded && "rotate-90"
                        )}
                        weight="bold"
                    />
                )}
            </button>

            {expanded &&
                children &&
                (bareChildren ? (
                    <div className="mt-1">{children}</div>
                ) : (
                    <div className="mt-1 max-h-48 overflow-y-auto">
                        {children}
                    </div>
                ))}
        </div>
    );
}

// ─── Tool-specific blocks ─────────────────────────────────────────────────────

interface ReadFileInput {
    path?: string;
    offset?: number;
    limit?: number;
}

interface ReadFileOutput {
    kind?: "text" | "image" | "pdf";
    path?: string;
    content?: string;
    size?: number;
    lineCount?: number;
    startLine?: number;
    endLine?: number;
    truncated?: boolean;
    mediaType?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function normalizePath(path: string): string {
    return path.replace(/\\/g, "/");
}

function trimWorkspacePath(
    path: string,
    workspacePath?: string | null
): string {
    const normalizedPath = normalizePath(path);
    const normalizedWorkspace = workspacePath
        ? normalizePath(workspacePath)
        : null;

    if (!normalizedWorkspace) {
        return normalizedPath;
    }

    const lowerPath = normalizedPath.toLowerCase();
    const lowerWorkspace = normalizedWorkspace.toLowerCase();

    if (lowerPath === lowerWorkspace) {
        return "";
    }

    if (lowerPath.startsWith(`${lowerWorkspace}/`)) {
        return normalizedPath.slice(normalizedWorkspace.length + 1);
    }

    return normalizedPath;
}

function countContentLines(content: string): number {
    if (content.length === 0) {
        return 0;
    }

    const newlineCount = content.match(/\r\n|\r|\n/g)?.length ?? 0;
    const endsWithNewline = /(?:\r\n|\r|\n)$/.test(content);

    return newlineCount + (endsWithNewline ? 0 : 1);
}

function formatLineRange(output: ReadFileOutput | undefined): string | null {
    if (!output) return null;

    if (
        typeof output.startLine === "number" &&
        typeof output.endLine === "number" &&
        output.endLine >= output.startLine &&
        output.startLine > 0
    ) {
        return `L${output.startLine}-${output.endLine}`;
    }

    if (typeof output.content !== "string") {
        return null;
    }

    const lineCount = countContentLines(output.content);
    if (lineCount <= 0) return null;
    return `L1-${lineCount}`;
}

function formatReadPath(
    rawPath: string | undefined,
    resolvedPath: string | undefined,
    workspacePath?: string | null
): string | null {
    const preferredPath = resolvedPath ?? rawPath;

    if (!preferredPath) {
        return null;
    }

    const trimmed = trimWorkspacePath(preferredPath, workspacePath);

    if (trimmed.length > 0 && trimmed !== "/") {
        return trimmed.replace(/^\//, "");
    }

    if (rawPath) {
        return normalizePath(rawPath).replace(/^[/\\]/, "");
    }

    return normalizePath(preferredPath);
}

function formatReadDetail(
    rawPath: string | undefined,
    output: ReadFileOutput | undefined,
    workspacePath?: string | null
): string | undefined {
    const pathLabel = formatReadPath(rawPath, output?.path, workspacePath);

    if (output?.kind === "image") {
        const kindLabel = output.mediaType
            ? output.mediaType.replace(/^image\//, "")
            : "image";
        return pathLabel ? `${pathLabel} · ${kindLabel}` : kindLabel;
    }

    if (output?.kind === "pdf") {
        return pathLabel ? `${pathLabel} · pdf` : "pdf";
    }

    const lineRange = formatLineRange(output);

    if (pathLabel && lineRange) {
        return `${pathLabel} ${lineRange}`;
    }

    return pathLabel ?? lineRange ?? undefined;
}

function ReadFileBlock({ invocation }: { invocation: ToolInvocation }) {
    const workspacePath = useWorkspaceStore((state) => {
        const activeWorkspace = state.workspaces.find(
            (workspace) => workspace.id === state.activeWorkspaceId
        );

        return activeWorkspace?.path ?? null;
    });
    const inputPath =
        isRecord(invocation.input) &&
        typeof (invocation.input as ReadFileInput).path === "string"
            ? (invocation.input as ReadFileInput).path
            : undefined;
    const output = isRecord(invocation.output)
        ? (invocation.output as ReadFileOutput)
        : undefined;
    const detail = formatReadDetail(inputPath, output, workspacePath);

    return (
        <ToolBlock
            icon={<FileTextIcon className="size-3.5" weight="bold" />}
            pendingLabel="Reading"
            successLabel="Read"
            errorLabel="Read failed"
            deniedLabel="Read denied"
            detail={detail}
            error={invocation.error}
            status={invocation.status}
        >
            {invocation.error && (
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-red-200">
                    {invocation.error}
                </p>
            )}
        </ToolBlock>
    );
}

// ─── Glob ─────────────────────────────────────────────────────────────────────

interface GlobInput {
    pattern?: string;
    path?: string;
    sortBy?: "mtime" | "name";
    headLimit?: number;
    offset?: number;
}

interface GlobOutput {
    matches?: string[];
    matchCount?: number;
    truncated?: boolean;
    sortBy?: "mtime" | "name";
    engine?: "ripgrep" | "walk";
}

function formatGlobDetail(
    input: GlobInput | undefined,
    output: GlobOutput | undefined
): string | undefined {
    const pattern =
        typeof input?.pattern === "string" && input.pattern.length > 0
            ? input.pattern
            : undefined;
    const count =
        typeof output?.matchCount === "number"
            ? output.matchCount
            : Array.isArray(output?.matches)
              ? output.matches.length
              : undefined;

    if (pattern && typeof count === "number") {
        const suffix = output?.truncated ? "+" : "";
        return `${pattern} · ${count}${suffix}`;
    }
    return pattern;
}

function GlobBlock({ invocation }: { invocation: ToolInvocation }) {
    const input = isRecord(invocation.input)
        ? (invocation.input as GlobInput)
        : undefined;
    const output = isRecord(invocation.output)
        ? (invocation.output as GlobOutput)
        : undefined;
    const matches = Array.isArray(output?.matches) ? output.matches : [];

    return (
        <ToolBlock
            icon={<FilesIcon className="size-3.5" weight="bold" />}
            pendingLabel="Finding files"
            successLabel="Found"
            errorLabel="Glob failed"
            deniedLabel="Glob denied"
            detail={formatGlobDetail(input, output)}
            error={invocation.error}
            status={invocation.status}
        >
            {invocation.error ? (
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-red-200">
                    {invocation.error}
                </p>
            ) : matches.length > 0 ? (
                <ul className="flex flex-col text-[11px] text-dark-200">
                    {matches.map((match, idx) => (
                        <li key={`${match}-${idx}`} className="truncate">
                            {match}
                        </li>
                    ))}
                    {output?.truncated && (
                        <li className="text-dark-300">
                            ... more results truncated
                        </li>
                    )}
                </ul>
            ) : null}
        </ToolBlock>
    );
}

// ─── Grep ─────────────────────────────────────────────────────────────────────

interface GrepInput {
    pattern?: string;
    include?: string;
    path?: string;
    type?: string;
    typeNot?: string;
    outputMode?: "content" | "files_with_matches" | "count";
    multiline?: boolean;
    context?: number;
    contextBefore?: number;
    contextAfter?: number;
}

interface GrepMatch {
    file?: string;
    line?: number;
    text?: string;
    isContext?: boolean;
}

interface GrepFileCount {
    file?: string;
    count?: number;
}

interface GrepOutput {
    outputMode?: "content" | "files_with_matches" | "count";
    matches?: GrepMatch[];
    files?: string[];
    counts?: GrepFileCount[];
    matchCount?: number;
    filesMatched?: number;
    truncated?: boolean;
}

function formatGrepDetail(
    input: GrepInput | undefined,
    output: GrepOutput | undefined
): string | undefined {
    const pattern =
        typeof input?.pattern === "string" && input.pattern.length > 0
            ? input.pattern
            : undefined;
    const mode = output?.outputMode ?? input?.outputMode ?? "content";
    const count =
        typeof output?.matchCount === "number"
            ? output.matchCount
            : Array.isArray(output?.matches)
              ? output.matches.length
              : Array.isArray(output?.files)
                ? output.files.length
                : Array.isArray(output?.counts)
                  ? output.counts.length
                  : undefined;
    const files = output?.filesMatched;

    if (pattern && typeof count === "number") {
        const suffix = output?.truncated ? "+" : "";
        const tail =
            mode === "files_with_matches"
                ? ` file${count === 1 ? "" : "s"}`
                : mode === "count"
                  ? ` match${count === 1 ? "" : "es"}`
                  : typeof files === "number" && files > 0
                    ? ` in ${files} files`
                    : "";
        return `${pattern} · ${count}${suffix}${tail}`;
    }
    return pattern;
}

function GrepBlock({ invocation }: { invocation: ToolInvocation }) {
    const input = isRecord(invocation.input)
        ? (invocation.input as GrepInput)
        : undefined;
    const output = isRecord(invocation.output)
        ? (invocation.output as GrepOutput)
        : undefined;
    const mode = output?.outputMode ?? "content";
    const matches = Array.isArray(output?.matches) ? output.matches : [];
    const files = Array.isArray(output?.files) ? output.files : [];
    const counts = Array.isArray(output?.counts) ? output.counts : [];

    return (
        <ToolBlock
            icon={<MagnifyingGlassIcon className="size-3.5" weight="bold" />}
            pendingLabel="Searching"
            successLabel="Searched"
            errorLabel="Grep failed"
            deniedLabel="Grep denied"
            detail={formatGrepDetail(input, output)}
            error={invocation.error}
            status={invocation.status}
        >
            {invocation.error ? (
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-red-200">
                    {invocation.error}
                </p>
            ) : mode === "files_with_matches" && files.length > 0 ? (
                <ul className="flex flex-col text-[11px] text-dark-200">
                    {files.map((file, idx) => (
                        <li key={`${file}-${idx}`} className="truncate">
                            {file}
                        </li>
                    ))}
                    {output?.truncated && (
                        <li className="text-dark-300">
                            ... more files truncated
                        </li>
                    )}
                </ul>
            ) : mode === "count" && counts.length > 0 ? (
                <ul className="flex flex-col text-[11px] text-dark-200">
                    {counts.map((row, idx) => (
                        <li
                            key={`${row.file ?? ""}-${idx}`}
                            className="truncate"
                        >
                            <span className="text-dark-300">
                                {row.count ?? 0}×
                            </span>{" "}
                            <span>{row.file ?? "?"}</span>
                        </li>
                    ))}
                    {output?.truncated && (
                        <li className="text-dark-300">
                            ... more files truncated
                        </li>
                    )}
                </ul>
            ) : matches.length > 0 ? (
                <ul className="flex flex-col text-[11px] text-dark-200">
                    {matches.map((match, idx) => (
                        <li
                            key={`${match.file ?? ""}-${match.line ?? 0}-${idx}`}
                            className={
                                match.isContext
                                    ? "truncate text-dark-300"
                                    : "truncate"
                            }
                        >
                            <span
                                className={
                                    match.isContext
                                        ? "text-dark-300"
                                        : "text-dark-200"
                                }
                            >
                                {match.file ?? "?"}:{match.line ?? "?"}
                            </span>
                            {match.text ? (
                                <>
                                    <span className="text-dark-300">
                                        {match.isContext ? "- " : ": "}
                                    </span>
                                    <span>{match.text}</span>
                                </>
                            ) : null}
                        </li>
                    ))}
                    {output?.truncated && (
                        <li className="text-dark-300">
                            ... more matches truncated
                        </li>
                    )}
                </ul>
            ) : null}
        </ToolBlock>
    );
}

// ─── Use skill ────────────────────────────────────────────────────────────────

interface UseSkillInput {
    name?: string;
}

interface UseSkillOutput {
    ok?: boolean;
    name?: string;
    description?: string;
    source?: "user" | "project";
    files?: string[];
    error?: string;
    requested?: string;
    available?: string[];
}

function formatSkillDetail(
    input: UseSkillInput | undefined,
    output: UseSkillOutput | undefined
): string | undefined {
    const name =
        (typeof output?.name === "string" && output.name.length > 0
            ? output.name
            : undefined) ??
        (typeof input?.name === "string" && input.name.length > 0
            ? input.name
            : undefined);

    if (!name) return undefined;

    if (output?.ok === false) {
        return name;
    }

    return name;
}

function UseSkillBlock({ invocation }: { invocation: ToolInvocation }) {
    const input = isRecord(invocation.input)
        ? (invocation.input as UseSkillInput)
        : undefined;
    const output = isRecord(invocation.output)
        ? (invocation.output as UseSkillOutput)
        : undefined;
    const detail = formatSkillDetail(input, output);
    const notFound = output?.ok === false;

    // Treat a "skill not found" return as an error-shaped result so the block
    // renders in the error style even though execute() didn't throw.
    const status: ToolInvocationStatus = notFound ? "error" : invocation.status;
    const error =
        invocation.error ??
        (notFound ? (output?.error ?? "Skill not found") : null);

    return (
        <ToolBlock
            icon={<BookOpenTextIcon className="size-3.5" weight="bold" />}
            pendingLabel="Loading skill"
            successLabel="Loaded skill"
            errorLabel="Skill failed"
            deniedLabel="Skill denied"
            detail={detail}
            error={error}
            status={status}
        />
    );
}

// ─── Question ─────────────────────────────────────────────────────────────────

interface QuestionSpecShape {
    question?: string;
    header?: string;
    options?: { label?: string; description?: string }[];
    multiple?: boolean;
}

interface QuestionInputShape {
    questions?: QuestionSpecShape[];
}

interface QuestionOutputShape {
    answers?: string[][];
}

function formatQuestionDetail(
    input: QuestionInputShape | undefined,
    output: QuestionOutputShape | undefined
): string | undefined {
    const count = Array.isArray(input?.questions)
        ? input.questions.length
        : undefined;
    const answered = Array.isArray(output?.answers)
        ? output.answers.length
        : undefined;

    if (typeof count !== "number") return undefined;
    const countLabel = `${count} ${count === 1 ? "question" : "questions"}`;
    if (typeof answered === "number" && answered > 0) {
        return `${countLabel} · answered`;
    }
    return countLabel;
}

function QuestionBlock({ invocation }: { invocation: ToolInvocation }) {
    const input = isRecord(invocation.input)
        ? (invocation.input as QuestionInputShape)
        : undefined;
    const output = isRecord(invocation.output)
        ? (invocation.output as QuestionOutputShape)
        : undefined;
    const detail = formatQuestionDetail(input, output);

    return (
        <ToolBlock
            icon={<ChatTeardropDotsIcon className="size-3.5" weight="fill" />}
            pendingLabel="Waiting for user input"
            successLabel="User input received"
            errorLabel="Question cancelled"
            deniedLabel="Question cancelled"
            detail={detail}
            error={invocation.error}
            status={invocation.status}
        />
    );
}

// ─── Todo write ───────────────────────────────────────────────────────────────

interface TodoWriteItemShape {
    id?: string;
    content?: string;
    status?: "pending" | "in_progress" | "completed" | "cancelled";
}

interface TodoWriteInputShape {
    todos?: TodoWriteItemShape[];
}

interface TodoWriteOutputShape {
    ok?: boolean;
    todos?: TodoWriteItemShape[];
    counts?: Partial<
        Record<"pending" | "in_progress" | "completed" | "cancelled", number>
    >;
}

const TODO_STATUS_GLYPH: Record<
    NonNullable<TodoWriteItemShape["status"]>,
    string
> = {
    pending: "○",
    in_progress: "◐",
    completed: "●",
    cancelled: "×"
};

function formatTodoDetail(
    output: TodoWriteOutputShape | undefined,
    input: TodoWriteInputShape | undefined
): string | undefined {
    const todos = output?.todos ?? input?.todos;
    if (!Array.isArray(todos)) return undefined;
    const total = todos.length;
    const completed = todos.filter((t) => t?.status === "completed").length;
    return `${completed}/${total}`;
}

function TodoWriteBlock({ invocation }: { invocation: ToolInvocation }) {
    const input = isRecord(invocation.input)
        ? (invocation.input as TodoWriteInputShape)
        : undefined;
    const output = isRecord(invocation.output)
        ? (invocation.output as TodoWriteOutputShape)
        : undefined;
    const todos = output?.todos ?? input?.todos ?? [];
    const detail = formatTodoDetail(output, input);

    return (
        <ToolBlock
            icon={<ListChecksIcon className="size-3.5" weight="bold" />}
            pendingLabel="Updating todos"
            successLabel="Updated todos"
            errorLabel="Todo update failed"
            detail={detail}
            error={invocation.error}
            status={invocation.status}
        >
            {invocation.error ? (
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-red-200">
                    {invocation.error}
                </p>
            ) : todos.length > 0 ? (
                <ul className="flex flex-col text-[11px] text-dark-200">
                    {todos.map((t, idx) => {
                        const status = t?.status ?? "pending";
                        const isDone =
                            status === "completed" || status === "cancelled";
                        return (
                            <li
                                key={t?.id ?? idx}
                                className="flex items-start gap-1.5"
                            >
                                <span className="shrink-0 text-dark-300">
                                    {TODO_STATUS_GLYPH[status]}
                                </span>
                                <span
                                    className={cn(
                                        "min-w-0",
                                        isDone && "text-dark-300 line-through"
                                    )}
                                >
                                    {t?.content ?? ""}
                                </span>
                            </li>
                        );
                    })}
                </ul>
            ) : null}
        </ToolBlock>
    );
}

// ─── Write plan ───────────────────────────────────────────────────────────────

function WritePlanBlock({ invocation }: { invocation: ToolInvocation }) {
    return (
        <ToolBlock
            icon={<NotepadIcon className="size-3.5" weight="bold" />}
            pendingLabel="Writing plan"
            successLabel="Created plan"
            errorLabel="Plan failed"
            error={invocation.error}
            status={invocation.status}
        />
    );
}

// ─── Image generation ─────────────────────────────────────────────────────────

interface ImageGenInputShape {
    prompt?: string;
}

interface ImageGenOutputShape {
    ok?: boolean;
    attachmentId?: string;
    fileName?: string;
    mimeType?: string;
    prompt?: string;
    revisedPrompt?: string | null;
    model?: string;
    error?: string;
}

function truncate(text: string, max: number): string {
    return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function formatImageGenDetail(
    input: ImageGenInputShape | undefined,
    output: ImageGenOutputShape | undefined
): string | undefined {
    const prompt =
        (typeof output?.prompt === "string" && output.prompt.length > 0
            ? output.prompt
            : undefined) ??
        (typeof input?.prompt === "string" && input.prompt.length > 0
            ? input.prompt
            : undefined);

    if (!prompt) return undefined;
    return truncate(prompt.replace(/\s+/g, " ").trim(), 60);
}

function ImageGenBlock({ invocation }: { invocation: ToolInvocation }) {
    const activeWorkspaceId = useWorkspaceStore(
        (state) => state.activeWorkspaceId
    );
    const input = isRecord(invocation.input)
        ? (invocation.input as ImageGenInputShape)
        : undefined;
    const output = isRecord(invocation.output)
        ? (invocation.output as ImageGenOutputShape)
        : undefined;
    const detail = formatImageGenDetail(input, output);

    const toolFailed = output?.ok === false;
    const status: ToolInvocationStatus = toolFailed
        ? "error"
        : invocation.status;
    const error =
        invocation.error ??
        (toolFailed ? (output?.error ?? "Image generation failed") : null);

    const imageUrl =
        output?.ok === true &&
        typeof output.attachmentId === "string" &&
        output.attachmentId.length > 0 &&
        activeWorkspaceId
            ? resolveAttachmentContentUrl(
                  activeWorkspaceId,
                  output.attachmentId
              )
            : null;

    const revised =
        output?.ok === true &&
        typeof output.revisedPrompt === "string" &&
        output.revisedPrompt.length > 0
            ? output.revisedPrompt
            : null;

    return (
        <ToolBlock
            icon={<ImageIcon className="size-3.5" weight="bold" />}
            pendingLabel="Generating image"
            successLabel="Generated image"
            errorLabel="Image generation failed"
            deniedLabel="Image generation denied"
            detail={detail}
            error={error}
            status={status}
            autoOpen
        >
            {error ? (
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-red-200">
                    {error}
                </p>
            ) : imageUrl ? (
                <div className="flex flex-col gap-1.5 py-1">
                    <a
                        href={imageUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="group inline-block w-fit overflow-hidden rounded border border-dark-700 bg-dark-900 transition-colors hover:border-dark-500"
                    >
                        <img
                            src={imageUrl}
                            alt={output?.prompt ?? "Generated image"}
                            loading="lazy"
                            className="block h-auto max-h-96 w-auto max-w-full object-contain"
                        />
                    </a>
                    {revised && (
                        <p className="max-w-xl text-[11px] leading-snug text-dark-300">
                            <span className="text-dark-200">
                                Revised prompt:
                            </span>{" "}
                            {revised}
                        </p>
                    )}
                </div>
            ) : null}
        </ToolBlock>
    );
}

// ─── Web search ───────────────────────────────────────────────────────────────

interface WebSearchInputShape {
    query?: string;
    maxResults?: number;
    categories?: string;
    language?: string;
    timeRange?: "day" | "month" | "year";
    safesearch?: 0 | 1 | 2;
}

interface WebSearchResultShape {
    title?: string;
    url?: string;
    content?: string;
    engine?: string | null;
    score?: number | null;
}

interface WebSearchOutputShape {
    ok?: boolean;
    query?: string;
    results?: WebSearchResultShape[];
    count?: number;
    truncated?: boolean;
    totalAvailable?: number;
    error?: string;
}

function hostnameOf(url: string): string {
    try {
        return new URL(url).hostname.replace(/^www\./, "");
    } catch {
        return url;
    }
}

function faviconUrl(url: string): string | null {
    try {
        const host = new URL(url).hostname;
        if (!host) return null;
        return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32`;
    } catch {
        return null;
    }
}

function formatWebSearchDetail(
    input: WebSearchInputShape | undefined,
    output: WebSearchOutputShape | undefined
): string | undefined {
    const query =
        (typeof output?.query === "string" && output.query.length > 0
            ? output.query
            : undefined) ??
        (typeof input?.query === "string" && input.query.length > 0
            ? input.query
            : undefined);
    const count =
        typeof output?.count === "number"
            ? output.count
            : Array.isArray(output?.results)
              ? output.results.length
              : undefined;

    if (!query) return undefined;
    const trimmedQuery = truncate(query.trim(), 48);
    if (typeof count === "number") {
        const suffix = output?.truncated ? "+" : "";
        return `${trimmedQuery} · ${count}${suffix} result${count === 1 ? "" : "s"}`;
    }
    return trimmedQuery;
}

function WebSearchBlock({ invocation }: { invocation: ToolInvocation }) {
    const input = isRecord(invocation.input)
        ? (invocation.input as WebSearchInputShape)
        : undefined;
    const output = isRecord(invocation.output)
        ? (invocation.output as WebSearchOutputShape)
        : undefined;

    const toolFailed = output?.ok === false;
    const status: ToolInvocationStatus = toolFailed
        ? "error"
        : invocation.status;
    const error =
        invocation.error ??
        (toolFailed ? (output?.error ?? "Web search failed") : null);

    const results = Array.isArray(output?.results) ? output.results : [];

    return (
        <ToolBlock
            icon={
                <GlobeHemisphereWestIcon className="size-3.5" weight="bold" />
            }
            pendingLabel="Searching the web"
            successLabel="Searched the web"
            errorLabel="Web search failed"
            deniedLabel="Web search denied"
            detail={formatWebSearchDetail(input, output)}
            error={error}
            status={status}
        >
            {error ? (
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-red-200">
                    {error}
                </p>
            ) : results.length > 0 ? (
                <ul className="flex flex-col gap-1.5 py-1">
                    {results.map((r, idx) => {
                        const url = typeof r.url === "string" ? r.url : "";
                        if (url.length === 0) return null;
                        const title =
                            typeof r.title === "string" && r.title.length > 0
                                ? r.title
                                : url;
                        const snippet =
                            typeof r.content === "string"
                                ? r.content.replace(/\s+/g, " ").trim()
                                : "";
                        const host = hostnameOf(url);
                        const favicon = faviconUrl(url);
                        const engine =
                            typeof r.engine === "string" && r.engine.length > 0
                                ? r.engine
                                : null;
                        return (
                            <li
                                key={`${url}-${idx}`}
                                className="group rounded-md border border-dark-700 bg-dark-900 px-2.5 py-1.5 transition-colors hover:border-dark-600 hover:bg-dark-850"
                            >
                                <a
                                    href={url}
                                    target="_blank"
                                    rel="noreferrer noopener"
                                    className="flex min-w-0 flex-col gap-0.5"
                                >
                                    <div className="flex min-w-0 items-center gap-1.5">
                                        <span className="inline-flex size-[14px] shrink-0 items-center justify-center overflow-hidden">
                                            {favicon ? (
                                                <img
                                                    src={favicon}
                                                    alt=""
                                                    width={14}
                                                    height={14}
                                                    loading="lazy"
                                                    className="size-[14px] object-contain"
                                                    onError={(e) => {
                                                        (
                                                            e.currentTarget as HTMLImageElement
                                                        ).style.visibility =
                                                            "hidden";
                                                    }}
                                                />
                                            ) : (
                                                <GlobeHemisphereWestIcon className="size-3 text-dark-300" />
                                            )}
                                        </span>
                                        <span className="min-w-0 truncate text-[11px] font-medium text-dark-100 group-hover:text-dark-50">
                                            {title}
                                        </span>
                                        <ArrowSquareOutIcon className="size-3 shrink-0 text-dark-200 opacity-0 transition-opacity group-hover:opacity-100" />
                                    </div>
                                    <div className="flex min-w-0 items-center gap-1 pl-[22px] text-[10px] text-dark-300">
                                        <span className="truncate">{host}</span>
                                        {engine && (
                                            <>
                                                <span className="text-dark-300">
                                                    ·
                                                </span>
                                                <span className="shrink-0 truncate">
                                                    {engine}
                                                </span>
                                            </>
                                        )}
                                    </div>
                                    {snippet.length > 0 && (
                                        <p className="pl-[22px] text-[11px] leading-snug text-dark-200 line-clamp-2">
                                            {snippet}
                                        </p>
                                    )}
                                </a>
                            </li>
                        );
                    })}
                    {output?.truncated &&
                        typeof output.totalAvailable === "number" && (
                            <li className="pl-[22px] text-[10px] text-dark-300">
                                … {output.totalAvailable - results.length} more
                                results truncated
                            </li>
                        )}
                </ul>
            ) : output?.ok === true ? (
                <p className="py-1 text-[11px] text-dark-300 italic">
                    No results returned.
                </p>
            ) : null}
        </ToolBlock>
    );
}

// ─── Web fetch ────────────────────────────────────────────────────────────────

interface WebFetchInputShape {
    url?: string;
    maxChars?: number;
}

interface WebFetchOutputShape {
    ok?: boolean;
    url?: string;
    finalUrl?: string;
    title?: string | null;
    description?: string | null;
    markdown?: string;
    charCount?: number;
    truncated?: boolean;
    statusCode?: number | null;
    error?: string;
}

function formatCharCount(n: number): string {
    if (n >= 1000) {
        const k = n / 1000;
        return `${k >= 10 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, "")}k chars`;
    }
    return `${n} chars`;
}

function formatWebFetchDetail(
    input: WebFetchInputShape | undefined,
    output: WebFetchOutputShape | undefined
): string | undefined {
    const url =
        (typeof output?.finalUrl === "string" && output.finalUrl.length > 0
            ? output.finalUrl
            : undefined) ??
        (typeof output?.url === "string" && output.url.length > 0
            ? output.url
            : undefined) ??
        (typeof input?.url === "string" && input.url.length > 0
            ? input.url
            : undefined);

    if (!url) return undefined;
    const host = hostnameOf(url);
    if (typeof output?.charCount === "number" && output.charCount > 0) {
        return `${host} · ${formatCharCount(output.charCount)}`;
    }
    return host;
}

const WEB_FETCH_PREVIEW_CHARS = 1200;

function WebFetchBlock({ invocation }: { invocation: ToolInvocation }) {
    const input = isRecord(invocation.input)
        ? (invocation.input as WebFetchInputShape)
        : undefined;
    const output = isRecord(invocation.output)
        ? (invocation.output as WebFetchOutputShape)
        : undefined;

    const toolFailed = output?.ok === false;
    const status: ToolInvocationStatus = toolFailed
        ? "error"
        : invocation.status;
    const error =
        invocation.error ??
        (toolFailed ? (output?.error ?? "Web fetch failed") : null);

    const detail = formatWebFetchDetail(input, output);

    const effectiveUrl =
        (typeof output?.finalUrl === "string" && output.finalUrl) ||
        (typeof output?.url === "string" && output.url) ||
        (typeof input?.url === "string" && input.url) ||
        "";
    const host = effectiveUrl ? hostnameOf(effectiveUrl) : "";
    const favicon = effectiveUrl ? faviconUrl(effectiveUrl) : null;
    const title =
        typeof output?.title === "string" && output.title.length > 0
            ? output.title
            : null;
    const description =
        typeof output?.description === "string" && output.description.length > 0
            ? output.description
            : null;
    const markdown =
        typeof output?.markdown === "string" ? output.markdown : "";
    const preview =
        markdown.length > WEB_FETCH_PREVIEW_CHARS
            ? markdown.slice(0, WEB_FETCH_PREVIEW_CHARS)
            : markdown;
    const previewHasMore = markdown.length > preview.length;
    const totalChars =
        typeof output?.charCount === "number"
            ? output.charCount
            : markdown.length;
    const remaining = Math.max(0, totalChars - preview.length);

    return (
        <ToolBlock
            icon={<DownloadSimpleIcon className="size-3.5" weight="bold" />}
            pendingLabel="Fetching page"
            successLabel="Fetched page"
            errorLabel="Web fetch failed"
            deniedLabel="Web fetch denied"
            detail={detail}
            error={error}
            status={status}
        >
            {error ? (
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-red-200">
                    {error}
                </p>
            ) : output?.ok === true ? (
                <div className="flex flex-col gap-1.5 py-1">
                    {effectiveUrl && (
                        <div className="flex min-w-0 items-center gap-1.5 rounded-md border border-dark-700 bg-dark-900 px-2.5 py-1.5">
                            <span className="inline-flex size-[14px] shrink-0 items-center justify-center overflow-hidden">
                                {favicon ? (
                                    <img
                                        src={favicon}
                                        alt=""
                                        width={14}
                                        height={14}
                                        loading="lazy"
                                        className="size-[14px] object-contain"
                                        onError={(e) => {
                                            (
                                                e.currentTarget as HTMLImageElement
                                            ).style.visibility = "hidden";
                                        }}
                                    />
                                ) : (
                                    <GlobeHemisphereWestIcon className="size-3 text-dark-300" />
                                )}
                            </span>
                            <div className="flex min-w-0 flex-1 flex-col">
                                {title && (
                                    <span className="truncate text-[11px] font-medium text-dark-100">
                                        {title}
                                    </span>
                                )}
                                <a
                                    href={effectiveUrl}
                                    target="_blank"
                                    rel="noreferrer noopener"
                                    className="flex min-w-0 items-center gap-1 text-[10px] text-dark-300 hover:text-dark-100"
                                >
                                    <span className="truncate">{host}</span>
                                    <ArrowSquareOutIcon className="size-3 shrink-0" />
                                </a>
                                {description && (
                                    <span className="truncate text-[10px] text-dark-300">
                                        {description}
                                    </span>
                                )}
                            </div>
                            {typeof output?.statusCode === "number" && (
                                <span className="shrink-0 rounded bg-dark-800 px-1.5 py-0.5 text-[10px] font-medium text-dark-200">
                                    {output.statusCode}
                                </span>
                            )}
                        </div>
                    )}
                    {preview.length > 0 ? (
                        <div className="max-h-48 overflow-y-auto rounded-md border border-dark-700 bg-dark-900 px-2.5 py-1.5">
                            <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-snug text-dark-200">
                                {preview}
                                {previewHasMore && "…"}
                            </pre>
                            {(previewHasMore || output?.truncated) && (
                                <p className="mt-1 text-[10px] italic text-dark-400">
                                    {previewHasMore
                                        ? `… ${remaining} more chars in preview`
                                        : ""}
                                    {output?.truncated &&
                                        " (response also truncated at maxChars)"}
                                </p>
                            )}
                        </div>
                    ) : (
                        <p className="px-1 text-[11px] italic text-dark-400">
                            Empty page — no markdown was extracted.
                        </p>
                    )}
                </div>
            ) : null}
        </ToolBlock>
    );
}

// ─── Partial JSON extraction (for streaming tool inputs) ──────────────────────

interface PartialString {
    value: string;
    complete: boolean;
}

/**
 * Walks a partial JSON object (as streamed by `tool-input-delta` chunks) and
 * returns top-level string-valued fields. Tolerates unterminated strings and
 * truncated input — an unfinished string returns `{ complete: false }` with
 * whatever text was streamed so far. Only the outermost object is considered,
 * so a key like `"path"` nested inside a value won't collide.
 */
function extractPartialTopLevelStrings(
    json: string
): Record<string, PartialString> {
    const result: Record<string, PartialString> = {};
    let i = 0;
    const n = json.length;

    const skipWs = () => {
        while (i < n && /\s/.test(json[i] ?? "")) i++;
    };

    const readString = (): PartialString => {
        i++;
        let out = "";
        while (i < n) {
            const ch = json[i]!;
            if (ch === "\\") {
                if (i + 1 >= n) return { value: out, complete: false };
                const next = json[i + 1]!;
                if (next === "u") {
                    if (i + 5 >= n) {
                        return { value: out, complete: false };
                    }
                    const hex = json.slice(i + 2, i + 6);
                    if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
                        return { value: out, complete: false };
                    }
                    out += String.fromCharCode(parseInt(hex, 16));
                    i += 6;
                    continue;
                }
                const escapeMap: Record<string, string> = {
                    n: "\n",
                    r: "\r",
                    t: "\t",
                    b: "\b",
                    f: "\f",
                    '"': '"',
                    "\\": "\\",
                    "/": "/"
                };
                out += escapeMap[next] ?? next;
                i += 2;
                continue;
            }
            if (ch === '"') {
                i++;
                return { value: out, complete: true };
            }
            out += ch;
            i++;
        }
        return { value: out, complete: false };
    };

    const skipValueNonString = () => {
        let depth = 0;
        while (i < n) {
            const ch = json[i]!;
            if (depth === 0 && (ch === "," || ch === "}")) return;
            if (ch === "{" || ch === "[") {
                depth++;
                i++;
                continue;
            }
            if (ch === "}" || ch === "]") {
                if (depth === 0) return;
                depth--;
                i++;
                continue;
            }
            if (ch === '"') {
                readString();
                continue;
            }
            i++;
        }
    };

    skipWs();
    if (i >= n || json[i] !== "{") return result;
    i++;

    while (i < n) {
        skipWs();
        if (i >= n) break;
        const ch = json[i];
        if (ch === "}") break;
        if (ch === ",") {
            i++;
            continue;
        }
        if (ch !== '"') break;
        const key = readString();
        if (!key.complete) break;
        skipWs();
        if (i >= n || json[i] !== ":") break;
        i++;
        skipWs();
        if (i >= n) break;
        if (json[i] === '"') {
            const val = readString();
            result[key.value] = val;
            if (!val.complete) break;
        } else {
            skipValueNonString();
        }
    }

    return result;
}

// ─── Write ────────────────────────────────────────────────────────────────────

interface WriteInputShape {
    path?: string;
    contents?: string;
}

interface WriteOutputShape {
    ok?: boolean;
    path?: string;
    relativePath?: string;
    bytesWritten?: number;
    lineCount?: number;
    created?: boolean;
    previousSize?: number | null;
}

function formatByteCount(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatWriteDetail(
    input: WriteInputShape | undefined,
    output: WriteOutputShape | undefined,
    workspacePath: string | null,
    partialPath: string | undefined
): string | undefined {
    const path =
        (typeof output?.path === "string" && output.path.length > 0
            ? output.path
            : undefined) ??
        (typeof input?.path === "string" && input.path.length > 0
            ? input.path
            : undefined) ??
        (typeof partialPath === "string" && partialPath.length > 0
            ? partialPath
            : undefined);

    const label = formatReadPath(
        typeof input?.path === "string" ? input.path : partialPath,
        path,
        workspacePath
    );
    if (!label) return undefined;

    if (typeof output?.bytesWritten === "number") {
        return `${label} · ${formatByteCount(output.bytesWritten)}`;
    }
    return label;
}

function WriteBlock({ invocation }: { invocation: ToolInvocation }) {
    const workspacePath = useWorkspaceStore((state) => {
        const active = state.workspaces.find(
            (w) => w.id === state.activeWorkspaceId
        );
        return active?.path ?? null;
    });

    const input = isRecord(invocation.input)
        ? (invocation.input as WriteInputShape)
        : undefined;
    const output = isRecord(invocation.output)
        ? (invocation.output as WriteOutputShape)
        : undefined;
    const streaming = invocation.input_streaming === true;
    const partialFields = streaming
        ? extractPartialTopLevelStrings(invocation.partial_input_text ?? "")
        : {};

    const partialPath = partialFields.path?.value;
    const partialContents = partialFields.contents?.value ?? "";
    const streamedBytes = partialContents.length;

    const finalContents =
        typeof input?.contents === "string" ? input.contents : undefined;
    const previewSource = finalContents ?? partialContents;
    const hasPreview = previewSource.length > 0;

    const detail = formatWriteDetail(input, output, workspacePath, partialPath);

    const rawPath =
        (typeof output?.path === "string" && output.path.length > 0
            ? output.path
            : undefined) ??
        (typeof input?.path === "string" && input.path.length > 0
            ? input.path
            : undefined) ??
        (typeof partialPath === "string" && partialPath.length > 0
            ? partialPath
            : undefined);
    const diffPath =
        formatReadPath(
            typeof input?.path === "string" ? input.path : partialPath,
            rawPath,
            workspacePath
        ) ?? "";

    return (
        <ToolBlock
            icon={<NotePencilIcon className="size-3.5" weight="bold" />}
            pendingLabel={
                streaming && streamedBytes > 0
                    ? "Writing"
                    : streaming
                      ? "Preparing write"
                      : "Writing"
            }
            successLabel={output?.created === false ? "Overwrote" : "Wrote"}
            errorLabel="Write failed"
            deniedLabel="Write denied"
            detail={detail}
            error={invocation.error}
            status={invocation.status}
            autoOpen
            autoClose
            bareChildren
        >
            {invocation.error ? (
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-red-200">
                    {invocation.error}
                </p>
            ) : hasPreview ? (
                <PierreDiff
                    path={diffPath}
                    oldContents=""
                    newContents={previewSource}
                />
            ) : streaming ? (
                <p className="px-1 py-1 text-[11px] italic text-dark-400">
                    Streaming file contents…
                </p>
            ) : null}
        </ToolBlock>
    );
}

// ─── Str replace ──────────────────────────────────────────────────────────────

interface StrReplaceInputShape {
    path?: string;
    old_string?: string;
    new_string?: string;
    replace_all?: boolean;
}

interface StrReplaceOutputShape {
    ok?: boolean;
    path?: string;
    relativePath?: string;
    replacements?: number;
    replaceAll?: boolean;
    bytesBefore?: number;
    bytesAfter?: number;
}

function formatStrReplaceDetail(
    input: StrReplaceInputShape | undefined,
    output: StrReplaceOutputShape | undefined,
    workspacePath: string | null,
    partialPath: string | undefined
): string | undefined {
    const path =
        (typeof output?.path === "string" && output.path.length > 0
            ? output.path
            : undefined) ??
        (typeof input?.path === "string" && input.path.length > 0
            ? input.path
            : undefined) ??
        (typeof partialPath === "string" && partialPath.length > 0
            ? partialPath
            : undefined);

    const label = formatReadPath(
        typeof input?.path === "string" ? input.path : partialPath,
        path,
        workspacePath
    );
    if (!label) return undefined;

    if (typeof output?.replacements === "number" && output.replacements > 0) {
        const plural = output.replacements === 1 ? "" : "s";
        return `${label} · ${output.replacements} edit${plural}`;
    }
    return label;
}

function StrReplaceBlock({ invocation }: { invocation: ToolInvocation }) {
    const workspacePath = useWorkspaceStore((state) => {
        const active = state.workspaces.find(
            (w) => w.id === state.activeWorkspaceId
        );
        return active?.path ?? null;
    });

    const input = isRecord(invocation.input)
        ? (invocation.input as StrReplaceInputShape)
        : undefined;
    const output = isRecord(invocation.output)
        ? (invocation.output as StrReplaceOutputShape)
        : undefined;
    const streaming = invocation.input_streaming === true;
    const partialFields = streaming
        ? extractPartialTopLevelStrings(invocation.partial_input_text ?? "")
        : {};

    const partialPath = partialFields.path?.value;
    const oldText =
        typeof input?.old_string === "string"
            ? input.old_string
            : (partialFields.old_string?.value ?? "");
    const newText =
        typeof input?.new_string === "string"
            ? input.new_string
            : (partialFields.new_string?.value ?? "");

    const detail = formatStrReplaceDetail(
        input,
        output,
        workspacePath,
        partialPath
    );

    const rawPath =
        (typeof output?.path === "string" && output.path.length > 0
            ? output.path
            : undefined) ??
        (typeof input?.path === "string" && input.path.length > 0
            ? input.path
            : undefined) ??
        (typeof partialPath === "string" && partialPath.length > 0
            ? partialPath
            : undefined);
    const diffPath =
        formatReadPath(
            typeof input?.path === "string" ? input.path : partialPath,
            rawPath,
            workspacePath
        ) ?? "";

    const hasAnyText = oldText.length > 0 || newText.length > 0;

    return (
        <ToolBlock
            icon={<PencilLineIcon className="size-3.5" weight="bold" />}
            pendingLabel={streaming ? "Editing" : "Applying edit"}
            successLabel="Edited"
            errorLabel="Edit failed"
            deniedLabel="Edit denied"
            detail={detail}
            error={invocation.error}
            status={invocation.status}
            autoOpen
            autoClose
            bareChildren
        >
            {invocation.error ? (
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-red-200">
                    {invocation.error}
                </p>
            ) : hasAnyText ? (
                <PierreDiff
                    path={diffPath}
                    oldContents={oldText}
                    newContents={newText}
                />
            ) : streaming ? (
                <p className="px-1 py-1 text-[11px] italic text-dark-400">
                    Streaming edit…
                </p>
            ) : null}
        </ToolBlock>
    );
}

// ─── Apply patch ──────────────────────────────────────────────────────────────

interface ApplyPatchInputShape {
    input?: string;
}

type ApplyPatchOp = "add" | "update" | "delete" | "rename";

interface ApplyPatchChangeShape {
    op?: ApplyPatchOp;
    path?: string;
    relativePath?: string;
    newPath?: string;
    newRelativePath?: string;
    oldContents?: string;
    newContents?: string;
    linesAdded?: number;
    linesRemoved?: number;
}

interface ApplyPatchSummaryShape {
    filesChanged?: number;
    filesAdded?: number;
    filesDeleted?: number;
    filesUpdated?: number;
    filesRenamed?: number;
    linesAdded?: number;
    linesRemoved?: number;
}

interface ApplyPatchOutputShape {
    ok?: boolean;
    changes?: ApplyPatchChangeShape[];
    summary?: ApplyPatchSummaryShape;
}

interface ParsedPatchFile {
    op: ApplyPatchOp;
    path: string;
    newPath?: string;
    /**
     * For add/delete, `before`/`after` are authoritative (full file content).
     * For update/rename while streaming, we synthesize a best-effort preview
     * by stitching together the hunk lines (- for before, + for after) — this
     * does NOT represent the full file but renders a readable diff until the
     * server returns the real oldContents/newContents post-apply.
     */
    before: string;
    after: string;
    complete: boolean;
}

/**
 * Tolerant, streaming-safe parser for the V4A patch envelope emitted by the
 * `apply_patch` tool. Unlike the server parser (which errors on anything
 * malformed so the model gets a useful signal), this one accepts truncated
 * input and stops gracefully at whatever it has seen so far. The output is a
 * list of per-file preview diffs the `ApplyPatchBlock` renders through
 * `PierreDiff`.
 */
function parsePatchForPreview(raw: string): ParsedPatchFile[] {
    if (!raw) return [];
    let text = raw.replace(/^\uFEFF/, "");
    text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

    const lines = text.split("\n");
    const files: ParsedPatchFile[] = [];

    const ADD = /^\*\*\*\s*Add File:\s*(.+?)\s*$/;
    const DEL = /^\*\*\*\s*Delete File:\s*(.+?)\s*$/;
    const UPD = /^\*\*\*\s*Update File:\s*(.+?)\s*$/;
    const MOV = /^\*\*\*\s*Move to:\s*(.+?)\s*$/;
    const END = /^\s*\*\*\*\s*End Patch\s*$/;
    const BEG = /^\s*\*\*\*\s*Begin Patch\s*$/;
    const EOF = /^\*\*\*\s*End of File\s*$/;
    const ANCH = /^@@/;
    const isSection = (l: string) =>
        ADD.test(l) || DEL.test(l) || UPD.test(l) || END.test(l);

    let inPatch = false;
    let i = 0;
    while (i < lines.length) {
        const line = lines[i]!;
        if (BEG.test(line)) {
            inPatch = true;
            i++;
            continue;
        }
        if (!inPatch) {
            i++;
            continue;
        }
        if (END.test(line)) break;

        let m: RegExpMatchArray | null;

        if ((m = line.match(ADD))) {
            const path = m[1]!.trim();
            const body: string[] = [];
            i++;
            while (i < lines.length && !isSection(lines[i]!)) {
                const cur = lines[i]!;
                if (EOF.test(cur)) {
                    i++;
                    continue;
                }
                if (cur.startsWith("+")) body.push(cur.slice(1));
                else if (cur.length === 0) body.push("");
                else break; // malformed mid-stream; stop this file
                i++;
            }
            files.push({
                op: "add",
                path,
                before: "",
                after: body.join("\n"),
                complete: i < lines.length && isSection(lines[i]!)
            });
            continue;
        }

        if ((m = line.match(DEL))) {
            files.push({
                op: "delete",
                path: m[1]!.trim(),
                before: "",
                after: "",
                complete: true
            });
            i++;
            continue;
        }

        if ((m = line.match(UPD))) {
            const path = m[1]!.trim();
            let moveTo: string | undefined;
            i++;
            if (i < lines.length) {
                const mv = lines[i]!.match(MOV);
                if (mv) {
                    moveTo = mv[1]!.trim();
                    i++;
                }
            }
            const beforeLines: string[] = [];
            const afterLines: string[] = [];
            while (i < lines.length && !isSection(lines[i]!)) {
                const cur = lines[i]!;
                if (EOF.test(cur)) {
                    i++;
                    continue;
                }
                if (ANCH.test(cur)) {
                    // Emit the anchor as a context-style hint so the diff view
                    // at least shows where the hunk lives.
                    beforeLines.push(cur);
                    afterLines.push(cur);
                    i++;
                    continue;
                }
                if (cur.length === 0) {
                    beforeLines.push("");
                    afterLines.push("");
                    i++;
                    continue;
                }
                const head = cur[0]!;
                const rest = cur.slice(1);
                if (head === " ") {
                    beforeLines.push(rest);
                    afterLines.push(rest);
                } else if (head === "-") {
                    beforeLines.push(rest);
                } else if (head === "+") {
                    afterLines.push(rest);
                } else {
                    // Unexpected mid-stream; break out of this file.
                    break;
                }
                i++;
            }
            files.push({
                op: moveTo ? "rename" : "update",
                path,
                newPath: moveTo,
                before: beforeLines.join("\n"),
                after: afterLines.join("\n"),
                complete: i < lines.length && isSection(lines[i]!)
            });
            continue;
        }

        i++;
    }

    return files;
}

const APPLY_PATCH_OP_LABEL: Record<ApplyPatchOp, string> = {
    add: "add",
    update: "edit",
    delete: "delete",
    rename: "rename"
};

function formatApplyPatchDetail(
    output: ApplyPatchOutputShape | undefined,
    previewFiles: ParsedPatchFile[]
): string | undefined {
    const summary = output?.summary;
    const changes = output?.changes;

    if (Array.isArray(changes) && changes.length > 0) {
        const filesChanged = summary?.filesChanged ?? changes.length;
        const added = summary?.linesAdded ?? 0;
        const removed = summary?.linesRemoved ?? 0;
        const fileWord = `${filesChanged} file${filesChanged === 1 ? "" : "s"}`;
        if (added > 0 || removed > 0) {
            return `${fileWord} · +${added} −${removed}`;
        }
        return fileWord;
    }

    if (previewFiles.length > 0) {
        const fileWord = `${previewFiles.length} file${previewFiles.length === 1 ? "" : "s"}`;
        return fileWord;
    }

    return undefined;
}

function ApplyPatchBlock({ invocation }: { invocation: ToolInvocation }) {
    const workspacePath = useWorkspaceStore((state) => {
        const active = state.workspaces.find(
            (w) => w.id === state.activeWorkspaceId
        );
        return active?.path ?? null;
    });

    const input = isRecord(invocation.input)
        ? (invocation.input as ApplyPatchInputShape)
        : undefined;
    const output = isRecord(invocation.output)
        ? (invocation.output as ApplyPatchOutputShape)
        : undefined;
    const streaming = invocation.input_streaming === true;
    const partialFields = streaming
        ? extractPartialTopLevelStrings(invocation.partial_input_text ?? "")
        : {};

    const finalInput =
        typeof input?.input === "string" ? input.input : undefined;
    const partialInput = partialFields.input?.value ?? "";
    const patchSource = finalInput ?? partialInput;

    // Prefer server-returned changes (authoritative full-file diffs). Fall
    // back to client-parsed preview (best-effort hunk view) while streaming
    // or if the tool errored before we had final results.
    const serverChanges = Array.isArray(output?.changes)
        ? output!.changes!
        : [];
    const previewFiles =
        serverChanges.length === 0 && patchSource.length > 0
            ? parsePatchForPreview(patchSource)
            : [];

    const detail = formatApplyPatchDetail(output, previewFiles);
    const hasAny = serverChanges.length > 0 || previewFiles.length > 0;

    return (
        <ToolBlock
            icon={<GitDiffIcon className="size-3.5" weight="bold" />}
            pendingLabel={streaming ? "Streaming patch" : "Applying patch"}
            successLabel="Applied patch"
            errorLabel="Patch failed"
            deniedLabel="Patch denied"
            detail={detail}
            error={invocation.error}
            status={invocation.status}
            autoOpen
            autoClose
            bareChildren
        >
            {invocation.error ? (
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-red-200">
                    {invocation.error}
                </p>
            ) : serverChanges.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                    {serverChanges.map((c, idx) => {
                        const displayPath =
                            formatReadPath(
                                c.relativePath ?? c.path,
                                c.path,
                                workspacePath
                            ) ??
                            c.relativePath ??
                            c.path ??
                            "";
                        const newDisplayPath =
                            c.newPath || c.newRelativePath
                                ? (formatReadPath(
                                      c.newRelativePath ?? c.newPath,
                                      c.newPath,
                                      workspacePath
                                  ) ??
                                  c.newRelativePath ??
                                  c.newPath ??
                                  "")
                                : "";
                        const headerPath =
                            c.op === "rename" && newDisplayPath
                                ? `${displayPath} → ${newDisplayPath}`
                                : displayPath;
                        return (
                            <div
                                key={`${displayPath}-${idx}`}
                                className="flex flex-col gap-1"
                            >
                                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-dark-300">
                                    <span className="rounded bg-dark-800 px-1.5 py-0.5 font-medium text-dark-200">
                                        {APPLY_PATCH_OP_LABEL[c.op ?? "update"]}
                                    </span>
                                    {typeof c.linesAdded === "number" &&
                                        c.linesAdded > 0 && (
                                            <span className="text-emerald-400 normal-case">
                                                +{c.linesAdded}
                                            </span>
                                        )}
                                    {typeof c.linesRemoved === "number" &&
                                        c.linesRemoved > 0 && (
                                            <span className="text-red-400 normal-case">
                                                −{c.linesRemoved}
                                            </span>
                                        )}
                                </div>
                                <PierreDiff
                                    path={headerPath}
                                    oldContents={c.oldContents ?? ""}
                                    newContents={c.newContents ?? ""}
                                />
                            </div>
                        );
                    })}
                </div>
            ) : previewFiles.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                    {previewFiles.map((f, idx) => {
                        const displayPath =
                            formatReadPath(f.path, f.path, workspacePath) ??
                            f.path;
                        const newDisplayPath = f.newPath
                            ? (formatReadPath(
                                  f.newPath,
                                  f.newPath,
                                  workspacePath
                              ) ?? f.newPath)
                            : "";
                        const headerPath =
                            f.op === "rename" && newDisplayPath
                                ? `${displayPath} → ${newDisplayPath}`
                                : displayPath;
                        return (
                            <div
                                key={`${f.path}-${idx}`}
                                className="flex flex-col gap-1"
                            >
                                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-dark-300">
                                    <span className="rounded bg-dark-800 px-1.5 py-0.5 font-medium text-dark-200">
                                        {APPLY_PATCH_OP_LABEL[f.op]}
                                    </span>
                                    {!f.complete && (
                                        <span className="normal-case text-dark-400 italic">
                                            streaming…
                                        </span>
                                    )}
                                </div>
                                {f.op === "delete" ? (
                                    <p className="px-1 text-[11px] italic text-dark-300">
                                        Deleting file.
                                    </p>
                                ) : (
                                    <PierreDiff
                                        path={headerPath}
                                        oldContents={f.before}
                                        newContents={f.after}
                                    />
                                )}
                            </div>
                        );
                    })}
                </div>
            ) : streaming ? (
                <p className="px-1 py-1 text-[11px] italic text-dark-400">
                    Streaming patch…
                </p>
            ) : !hasAny ? (
                <p className="px-1 py-1 text-[11px] italic text-dark-400">
                    No changes applied.
                </p>
            ) : null}
        </ToolBlock>
    );
}

// ─── shell + await_shell ──────────────────────────────────────────────────────

interface ShellInputShape {
    command?: string;
    description?: string;
    working_directory?: string;
    block_until_ms?: number;
}

interface ShellOutputShape {
    status?: "completed" | "backgrounded" | "killed" | "streaming";
    state?:
        | "running_foreground"
        | "running_background"
        | "completed"
        | "killed";
    task_id?: string;
    exit_code?: number | null;
    pid?: number | null;
    cwd?: string;
    output?: string;
    partial_output?: string;
    running_for_ms?: number;
    log_path?: string;
    output_truncated?: boolean;
    streaming?: boolean;
}

function chunksFromPersistedOutput(
    output: ShellOutputShape | undefined
): ShellStreamChunk[] {
    if (!output) return [];
    const body =
        typeof output.output === "string" && output.output.length > 0
            ? output.output
            : typeof output.partial_output === "string"
              ? output.partial_output
              : "";
    if (body.length === 0) return [];
    return [{ stream: "stdout", chunk: body }];
}

/**
 * Render a string containing ANSI escape sequences (colors, styles, cursor
 * moves) as styled React nodes. Uses `anser` for parsing — we don't want to
 * hand-roll this because ANSI has a long tail of edge cases (256-colour,
 * truecolor, SGR combinations, OSC/DEC sequences, etc).
 */
function ansiToNodes(text: string, keyPrefix: string): React.ReactNode[] {
    if (!text) return [];
    const parts = Anser.ansiToJson(text, {
        use_classes: false,
        json: true,
        remove_empty: true
    });

    return parts.map((part, idx) => {
        const style: React.CSSProperties = {};
        if (part.fg) style.color = `rgb(${part.fg})`;
        if (part.bg) style.backgroundColor = `rgb(${part.bg})`;

        const decos = Array.isArray(part.decorations)
            ? part.decorations
            : typeof part.decoration === "string"
              ? [part.decoration]
              : [];
        const decorations: string[] = [];
        if (decos.includes("bold")) style.fontWeight = 600;
        if (decos.includes("dim")) style.opacity = 0.7;
        if (decos.includes("italic")) style.fontStyle = "italic";
        if (decos.includes("underline")) decorations.push("underline");
        if (decos.includes("strikethrough")) decorations.push("line-through");
        if (decorations.length > 0) {
            style.textDecoration = decorations.join(" ");
        }
        if (decos.includes("reverse")) {
            const fg = style.color;
            style.color = style.backgroundColor ?? "inherit";
            style.backgroundColor = fg ?? "inherit";
        }
        if (decos.includes("hidden")) style.visibility = "hidden";

        return (
            <span key={`${keyPrefix}-${idx}`} style={style}>
                {part.content}
            </span>
        );
    });
}

interface TerminalPaneProps {
    chunks: readonly ShellStreamChunk[];
    isStreaming: boolean;
    truncated?: boolean;
    emptyLabel?: string;
    command?: string;
    workingDirectory?: string;
}

function TerminalPane({
    chunks,
    isStreaming,
    truncated,
    emptyLabel,
    command,
    workingDirectory
}: TerminalPaneProps) {
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const pinnedToBottomRef = useRef(true);

    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        const handleScroll = () => {
            const distanceFromBottom =
                el.scrollHeight - el.scrollTop - el.clientHeight;
            pinnedToBottomRef.current = distanceFromBottom < 24;
        };
        el.addEventListener("scroll", handleScroll, { passive: true });
        return () => el.removeEventListener("scroll", handleScroll);
    }, []);

    useEffect(() => {
        if (!pinnedToBottomRef.current) return;
        const el = scrollRef.current;
        if (!el) return;
        el.scrollTop = el.scrollHeight;
    }, [chunks, isStreaming]);

    const rendered = useMemo(() => {
        return chunks.map((part, idx) => {
            const isStderr = part.stream === "stderr";
            const nodes = ansiToNodes(part.chunk, `c${idx}`);
            if (!isStderr) {
                return <span key={idx}>{nodes}</span>;
            }
            return (
                <span key={idx} className="text-red-300">
                    {nodes}
                </span>
            );
        });
    }, [chunks]);

    const hasOutput = chunks.length > 0;
    const hasCommand = typeof command === "string" && command.length > 0;
    const showEmpty = !hasOutput && !isStreaming && !hasCommand;

    if (showEmpty) {
        return (
            <div className="rounded-md border border-dark-700 bg-dark-900 px-2.5 py-1.5 font-mono text-[11px] text-dark-200">
                {emptyLabel ?? "(no output)"}
            </div>
        );
    }

    return (
        <div className="overflow-hidden rounded-md border border-dark-700 bg-dark-900 font-mono text-[11px] leading-[1.5] text-dark-100">
            {(hasCommand || workingDirectory) && (
                <div className="flex flex-col gap-0.5 border-b border-dark-700 px-2.5 pt-1.5 pb-1.5">
                    {hasCommand && (
                        <div className="flex min-w-0 items-baseline gap-1.5">
                            <span
                                aria-hidden
                                className="shrink-0 select-none text-dark-300"
                            >
                                $
                            </span>
                            <span className="min-w-0 break-all text-dark-50">
                                {command}
                            </span>
                        </div>
                    )}
                    {workingDirectory && (
                        <div className="flex min-w-0 font-sans text-[11px] text-dark-300">
                            <span className="min-w-0 truncate">
                                {workingDirectory}
                            </span>
                        </div>
                    )}
                </div>
            )}
            {truncated && (
                <div className="border-b border-dark-700 px-2.5 py-1 text-[11px] text-amber-200/80">
                    in-memory buffer truncated — see log_path for full output
                </div>
            )}
            <div
                ref={scrollRef}
                className="max-h-56 overflow-y-auto px-2.5 py-1.5"
            >
                {!hasOutput && !isStreaming ? (
                    <span className="text-dark-200">
                        {emptyLabel ?? "(no output)"}
                    </span>
                ) : (
                    <pre className="whitespace-pre-wrap break-words">
                        {rendered}
                        {isStreaming && (
                            <span
                                aria-hidden
                                className="ml-0.5 inline-block w-[7px] animate-pulse bg-dark-200 align-baseline"
                            >
                                &#x2007;
                            </span>
                        )}
                    </pre>
                )}
            </div>
        </div>
    );
}

function formatShellDuration(ms: number | undefined | null): string {
    if (typeof ms !== "number" || !Number.isFinite(ms)) return "";
    if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
    const seconds = ms / 1000;
    if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
    const minutes = Math.floor(seconds / 60);
    const remSec = Math.round(seconds - minutes * 60);
    return `${minutes}m ${remSec}s`;
}

function ShellBlock({ invocation }: { invocation: ToolInvocation }) {
    const input: ShellInputShape = isRecord(invocation.input)
        ? (invocation.input as ShellInputShape)
        : {};
    const partial = isRecord(invocation.partial_input_text)
        ? undefined
        : undefined;
    void partial;

    const output = isRecord(invocation.output)
        ? (invocation.output as ShellOutputShape)
        : undefined;

    const streamState: ShellStreamState | undefined = invocation.shell_stream;

    // Prefer live chunks if we've been streaming this session; otherwise
    // hydrate from the persisted output body so reloading a completed tool
    // call still shows its output, just without stream-vs-stdout coloring.
    const liveChunks = streamState?.chunks ?? [];
    const hydratedChunks =
        liveChunks.length === 0
            ? chunksFromPersistedOutput(output)
            : liveChunks;

    const command = typeof input.command === "string" ? input.command : "";
    const description =
        typeof input.description === "string" && input.description.length > 0
            ? input.description
            : command.slice(0, 60);

    const workingDirectory =
        typeof input.working_directory === "string" &&
        input.working_directory.trim().length > 0
            ? input.working_directory
            : undefined;

    const isPending = invocation.status === "pending";
    const isBackgrounded =
        streamState?.state === "running_background" ||
        output?.status === "backgrounded" ||
        output?.state === "running_background";
    const exitCode =
        streamState?.exit_code ??
        (typeof output?.exit_code === "number" ? output.exit_code : null);
    const runningMs =
        typeof output?.running_for_ms === "number"
            ? output.running_for_ms
            : undefined;
    const truncated = Boolean(
        output?.output_truncated || streamState?.truncated
    );

    const pendingLabel = `Running "${description}"`;
    const successLabel = isBackgrounded
        ? `Backgrounded "${description}"`
        : `Ran "${description}"`;
    const errorLabel = `Shell failed`;

    const detailBits: string[] = [];
    if (!isPending && typeof exitCode === "number") {
        detailBits.push(`exit ${exitCode}`);
    }
    if (!isPending && typeof runningMs === "number") {
        const dur = formatShellDuration(runningMs);
        if (dur) detailBits.push(dur);
    }
    if (isBackgrounded) {
        const tid = streamState?.task_id ?? output?.task_id ?? invocation.id;
        if (tid) detailBits.push(`task ${tid.slice(0, 8)}`);
    }
    const detail = detailBits.join(" · ");

    return (
        <ToolBlock
            icon={<TerminalWindowIcon className="size-3.5" weight="bold" />}
            pendingLabel={pendingLabel}
            successLabel={successLabel}
            errorLabel={errorLabel}
            deniedLabel="Shell denied"
            detail={detail || undefined}
            error={invocation.error}
            status={invocation.status}
            autoOpen
            autoClose
        >
            <div className="flex flex-col gap-1.5 py-1">
                <TerminalPane
                    chunks={hydratedChunks}
                    isStreaming={isPending}
                    truncated={truncated}
                    command={command || undefined}
                    workingDirectory={workingDirectory}
                    emptyLabel={
                        isBackgrounded
                            ? "Backgrounded — poll with await_shell for more output."
                            : "(command produced no output)"
                    }
                />
                {invocation.error && (
                    <p className="whitespace-pre-wrap text-xs leading-relaxed text-red-200">
                        {invocation.error}
                    </p>
                )}
            </div>
        </ToolBlock>
    );
}

interface AwaitShellInputShape {
    task_id?: string;
    block_until_ms?: number;
    pattern?: string;
}

interface AwaitShellOutputShape {
    status?: "completed" | "backgrounded" | "killed" | "sleep" | "not_found";
    task_id?: string | null;
    new_output?: string;
    partial_output?: string;
    elapsed_ms?: number;
    pattern_matched?: boolean;
    pattern?: string;
    snapshot?: {
        exit_code?: number | null;
        running_for_ms?: number;
        log_path?: string;
    };
    streaming?: boolean;
}

function AwaitShellBlock({ invocation }: { invocation: ToolInvocation }) {
    const input: AwaitShellInputShape = isRecord(invocation.input)
        ? (invocation.input as AwaitShellInputShape)
        : {};
    const output = isRecord(invocation.output)
        ? (invocation.output as AwaitShellOutputShape)
        : undefined;

    const streamState: ShellStreamState | undefined = invocation.shell_stream;
    const liveChunks = streamState?.chunks ?? [];
    const persistedBody =
        typeof output?.new_output === "string" && output.new_output.length > 0
            ? output.new_output
            : typeof output?.partial_output === "string"
              ? output.partial_output
              : "";
    const hydratedChunks: ShellStreamChunk[] =
        liveChunks.length > 0
            ? liveChunks
            : persistedBody.length > 0
              ? [{ stream: "stdout", chunk: persistedBody }]
              : [];

    const taskId =
        input.task_id ?? output?.task_id ?? streamState?.task_id ?? undefined;
    const isSleep =
        output?.status === "sleep" ||
        (invocation.status !== "pending" && !taskId);
    const blockMs =
        typeof input.block_until_ms === "number"
            ? input.block_until_ms
            : undefined;

    const isPending = invocation.status === "pending";
    const matched = output?.pattern_matched === true;
    const snapshotState = output?.status;

    const pendingLabel = taskId
        ? `Awaiting shell${input.pattern ? ` for /${input.pattern}/` : ""}`
        : blockMs !== undefined
          ? `Sleeping ${formatShellDuration(blockMs)}`
          : "Awaiting";
    const successLabel = isSleep
        ? "Slept"
        : snapshotState === "completed"
          ? `Shell completed`
          : snapshotState === "killed"
            ? `Shell killed`
            : snapshotState === "not_found"
              ? `Task not found`
              : matched
                ? `Pattern matched`
                : `Still running`;

    const detailBits: string[] = [];
    if (taskId && typeof taskId === "string") {
        detailBits.push(`task ${taskId.slice(0, 8)}`);
    }
    if (typeof output?.snapshot?.exit_code === "number") {
        detailBits.push(`exit ${output.snapshot.exit_code}`);
    }
    if (typeof output?.elapsed_ms === "number") {
        const dur = formatShellDuration(output.elapsed_ms);
        if (dur) detailBits.push(dur);
    }
    const detail = detailBits.join(" · ");

    const hasBody = hydratedChunks.length > 0 || isPending;

    return (
        <ToolBlock
            icon={<HourglassMediumIcon className="size-3.5" weight="bold" />}
            pendingLabel={pendingLabel}
            successLabel={successLabel}
            errorLabel="await_shell failed"
            deniedLabel="await_shell denied"
            detail={detail || undefined}
            error={invocation.error}
            status={invocation.status}
            autoOpen
            autoClose
        >
            <div className="flex flex-col gap-1.5 py-1">
                {hasBody && !isSleep && (
                    <TerminalPane
                        chunks={hydratedChunks}
                        isStreaming={isPending}
                        command={
                            input.pattern
                                ? `await /${input.pattern}/m`
                                : undefined
                        }
                        emptyLabel="(no new output since attach)"
                    />
                )}
                {invocation.error && (
                    <p className="whitespace-pre-wrap text-xs leading-relaxed text-red-200">
                        {invocation.error}
                    </p>
                )}
            </div>
        </ToolBlock>
    );
}

// ─── Task (subagents) ─────────────────────────────────────────────────────────

interface TaskInputShape {
    subagent_type?: string;
    description?: string;
    prompt?: string;
    model?: string;
}

interface TaskOutputShape {
    subagentId?: string;
    subagentName?: string;
    subagentType?: string;
    finalText?: string;
    aborted?: boolean;
}

const SUBAGENT_TYPE_LABEL: Record<SubagentType, string> = {
    generalPurpose: "General",
    explore: "Explore",
    shell: "Shell",
    docs: "Docs",
    "best-of-n-runner": "Best-of-N"
};

function TaskBlock({ invocation }: { invocation: ToolInvocation }) {
    const input: TaskInputShape = isRecord(invocation.input)
        ? (invocation.input as TaskInputShape)
        : {};
    const output: TaskOutputShape | undefined = isRecord(invocation.output)
        ? (invocation.output as TaskOutputShape)
        : undefined;

    // subagent_id is hydrated (a) live via subagent-started and (b) from
    // output.subagentId for completed rows. Prefer the live link so the
    // card is clickable the moment the subagent row exists.
    const subagentId =
        invocation.subagent_id ?? output?.subagentId ?? undefined;

    // Pull live subagent metadata (name, type, latest assistant text snippet)
    // from the parent's subagentsByParentId map + the subagent conversation
    // if it has been hydrated via observeConversation.
    const subagentConversation = useConversationStore((s) =>
        subagentId ? s.conversationsById[subagentId] : undefined
    );
    const parentId = subagentConversation?.parent_conversation_id ?? null;
    const parentSubagents = useConversationStore((s) =>
        parentId ? s.subagentsByParentId[parentId] : undefined
    );
    const liveSubagent = useMemo(() => {
        if (!subagentId || !parentSubagents) return undefined;
        return parentSubagents.find((c) => c.id === subagentId);
    }, [parentSubagents, subagentId]);

    const subagentName =
        output?.subagentName ??
        liveSubagent?.subagent_name ??
        subagentConversation?.subagent_name ??
        null;
    const subagentTypeRaw =
        (output?.subagentType as SubagentType | undefined) ??
        (liveSubagent?.subagent_type as SubagentType | null | undefined) ??
        (subagentConversation?.subagent_type as
            | SubagentType
            | null
            | undefined) ??
        (input.subagent_type as SubagentType | undefined);
    const subagentTypeLabel =
        subagentTypeRaw && subagentTypeRaw in SUBAGENT_TYPE_LABEL
            ? SUBAGENT_TYPE_LABEL[subagentTypeRaw as SubagentType]
            : (subagentTypeRaw ?? "subagent");

    const isPending = invocation.status === "pending";
    const wasAborted = output?.aborted === true;

    const header = subagentName
        ? `${subagentName} · ${subagentTypeLabel}`
        : `Subagent · ${subagentTypeLabel}`;
    const pendingLabel = `${header} · working`;
    const successLabel = wasAborted
        ? `${header} · aborted`
        : `${header} · done`;
    const errorLabel = `${header} · failed`;
    const deniedLabel = `${header} · denied`;

    // Build a live preview of the last streamed assistant text while the
    // subagent is still running. Falls back to the tool-output finalText
    // once the subagent finishes.
    const livePreview = useMemo(() => {
        if (!subagentConversation) return "";
        const messages = subagentConversation.messages ?? [];
        for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            if (msg?.role === "assistant" && msg.content.length > 0) {
                return msg.content;
            }
        }
        return "";
    }, [subagentConversation]);

    const bodyText =
        (!isPending && output?.finalText) ||
        livePreview ||
        input.prompt ||
        "";

    const detailBits: string[] = [];
    if (input.description && input.description.length > 0) {
        detailBits.push(input.description);
    }
    const detail = detailBits.join(" · ") || undefined;

    const cardIcon = <RobotIcon className="size-3.5" weight="bold" />;

    const card = (
        <ToolBlock
            icon={cardIcon}
            pendingLabel={pendingLabel}
            successLabel={successLabel}
            errorLabel={errorLabel}
            deniedLabel={deniedLabel}
            detail={detail}
            error={invocation.error}
            status={invocation.status}
            autoOpen
            autoClose
        >
            <div className="flex flex-col gap-1.5 py-1">
                {bodyText && (
                    <p className="whitespace-pre-wrap text-xs leading-relaxed text-dark-300">
                        {bodyText.length > 600
                            ? `${bodyText.slice(-600)}`
                            : bodyText}
                    </p>
                )}
                {subagentId && (
                    <p className="text-[11px] leading-relaxed text-dark-400">
                        Click to open {subagentName ?? "subagent"}'s live view
                        →
                    </p>
                )}
                {invocation.error && (
                    <p className="whitespace-pre-wrap text-xs leading-relaxed text-red-200">
                        {invocation.error}
                    </p>
                )}
            </div>
        </ToolBlock>
    );

    if (!subagentId) {
        return card;
    }

    return (
        <Link
            to="/conversations/$conversationId"
            params={{ conversationId: subagentId }}
            className="block no-underline"
            aria-label={`Open subagent ${subagentName ?? "conversation"}`}
        >
            {card}
        </Link>
    );
}

function GenericToolBlock({ invocation }: { invocation: ToolInvocation }) {
    return (
        <ToolBlock
            icon={<WrenchIcon className="size-3.5" weight="bold" />}
            pendingLabel={invocation.tool_name}
            successLabel={invocation.tool_name}
            errorLabel={`${invocation.tool_name} failed`}
            deniedLabel={`${invocation.tool_name} denied`}
            error={invocation.error}
            status={invocation.status}
        >
            {invocation.error && (
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-red-200">
                    {invocation.error}
                </p>
            )}
        </ToolBlock>
    );
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────

interface ToolCallCardProps {
    invocation: ToolInvocation;
}

export function ToolCallCard({ invocation }: ToolCallCardProps) {
    switch (invocation.tool_name) {
        case "read_file":
            return <ReadFileBlock invocation={invocation} />;
        case "glob":
            return <GlobBlock invocation={invocation} />;
        case "grep":
            return <GrepBlock invocation={invocation} />;
        case "use_skill":
            return <UseSkillBlock invocation={invocation} />;
        case "question":
            return <QuestionBlock invocation={invocation} />;
        case "todo_write":
            return <TodoWriteBlock invocation={invocation} />;
        case "write_plan":
            return <WritePlanBlock invocation={invocation} />;
        case "image_gen":
            return <ImageGenBlock invocation={invocation} />;
        case "web_search":
            return <WebSearchBlock invocation={invocation} />;
        case "web_fetch":
            return <WebFetchBlock invocation={invocation} />;
        case "write":
            return <WriteBlock invocation={invocation} />;
        case "str_replace":
            return <StrReplaceBlock invocation={invocation} />;
        case "apply_patch":
            return <ApplyPatchBlock invocation={invocation} />;
        case "shell":
            return <ShellBlock invocation={invocation} />;
        case "await_shell":
            return <AwaitShellBlock invocation={invocation} />;
        case "task":
            return <TaskBlock invocation={invocation} />;
        default:
            return <GenericToolBlock invocation={invocation} />;
    }
}
