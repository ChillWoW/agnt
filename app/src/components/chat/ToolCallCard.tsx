import { useState, useEffect, useRef } from "react";
import {
    ArrowSquareOutIcon,
    BookOpenTextIcon,
    CaretRightIcon,
    ChatTeardropDotsIcon,
    DownloadSimpleIcon,
    FileTextIcon,
    FilesIcon,
    GlobeHemisphereWestIcon,
    ImageIcon,
    ListChecksIcon,
    MagnifyingGlassIcon,
    NotePencilIcon,
    PencilLineIcon,
    WrenchIcon
} from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import type {
    ToolInvocation,
    ToolInvocationStatus
} from "@/features/conversations/conversation-types";
import { useWorkspaceStore } from "@/features/workspaces";
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
                <ul className="flex flex-col gap-0.5 text-[11px] text-dark-200">
                    {matches.map((match, idx) => (
                        <li key={`${match}-${idx}`} className="truncate">
                            {match}
                        </li>
                    ))}
                    {output?.truncated && (
                        <li className="text-dark-300 italic">
                            … more results truncated
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
                <ul className="flex flex-col gap-0.5 text-[11px] text-dark-200">
                    {files.map((file, idx) => (
                        <li key={`${file}-${idx}`} className="truncate">
                            {file}
                        </li>
                    ))}
                    {output?.truncated && (
                        <li className="text-dark-300 italic">
                            … more files truncated
                        </li>
                    )}
                </ul>
            ) : mode === "count" && counts.length > 0 ? (
                <ul className="flex flex-col gap-0.5 text-[11px] text-dark-200">
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
                        <li className="text-dark-300 italic">
                            … more files truncated
                        </li>
                    )}
                </ul>
            ) : matches.length > 0 ? (
                <ul className="flex flex-col gap-0.5 text-[11px] text-dark-200">
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
                        <li className="text-dark-300 italic">
                            … more matches truncated
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
    const questions = Array.isArray(input?.questions) ? input.questions : [];
    const answers = Array.isArray(output?.answers) ? output.answers : [];

    return (
        <ToolBlock
            icon={<ChatTeardropDotsIcon className="size-3.5" weight="fill" />}
            pendingLabel="Waiting for your answer"
            successLabel="Asked you"
            errorLabel="Question cancelled"
            deniedLabel="Question cancelled"
            detail={detail}
            error={invocation.error}
            status={invocation.status}
        >
            {invocation.error ? (
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-red-200">
                    {invocation.error}
                </p>
            ) : questions.length > 0 ? (
                <ul className="flex flex-col gap-1.5 text-[11px] text-dark-200">
                    {questions.map((q, idx) => {
                        const qAnswers = answers[idx] ?? [];
                        const header = q.header ?? `Question ${idx + 1}`;
                        return (
                            <li key={idx} className="flex flex-col gap-0.5">
                                <div className="flex items-center gap-1.5">
                                    <span className="inline-flex shrink-0 items-center rounded bg-dark-800 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-dark-200">
                                        {header}
                                    </span>
                                    {q.question && (
                                        <span className="truncate text-dark-200">
                                            {q.question}
                                        </span>
                                    )}
                                </div>
                                {qAnswers.length > 0 && (
                                    <div className="flex flex-wrap gap-1 pl-1">
                                        {qAnswers.map((a, aIdx) => (
                                            <span
                                                key={aIdx}
                                                className="rounded bg-primary-100/15 px-1.5 py-0.5 text-[10px] text-primary-100 ring-1 ring-inset ring-primary-100/30"
                                            >
                                                {a}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </li>
                        );
                    })}
                </ul>
            ) : null}
        </ToolBlock>
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
                <ul className="flex flex-col gap-0.5 text-[11px] text-dark-200">
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
                                className="group rounded-md border border-dark-700 bg-dark-900/40 px-2 py-1.5 transition-colors hover:border-dark-500 hover:bg-dark-900/80"
                            >
                                <a
                                    href={url}
                                    target="_blank"
                                    rel="noreferrer noopener"
                                    className="flex min-w-0 flex-col gap-0.5"
                                >
                                    <div className="flex min-w-0 items-center gap-1.5">
                                        <span className="inline-flex size-[14px] shrink-0 items-center justify-center overflow-hidden rounded-[3px] bg-dark-800">
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
                                        <ArrowSquareOutIcon className="size-3 shrink-0 text-dark-400 opacity-0 transition-opacity group-hover:opacity-100" />
                                    </div>
                                    <div className="flex min-w-0 items-center gap-1 pl-[22px] text-[10px] text-dark-300">
                                        <span className="truncate">{host}</span>
                                        {engine && (
                                            <>
                                                <span className="text-dark-500">
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
                            <li className="pl-[22px] text-[10px] italic text-dark-400">
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
                        <div className="flex min-w-0 items-center gap-1.5 rounded-md border border-dark-700 bg-dark-900/40 px-2 py-1.5">
                            <span className="inline-flex size-[14px] shrink-0 items-center justify-center overflow-hidden rounded-[3px] bg-dark-800">
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
                        <div className="max-h-48 overflow-y-auto rounded-md border border-dark-700 bg-dark-900/60 px-2 py-1.5">
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
        default:
            return <GenericToolBlock invocation={invocation} />;
    }
}
