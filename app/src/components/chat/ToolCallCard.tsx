import { useState, useEffect, useRef } from "react";
import {
    CaretRightIcon,
    FileTextIcon,
    FilesIcon,
    MagnifyingGlassIcon,
    WrenchIcon
} from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import type {
    ToolInvocation,
    ToolInvocationStatus
} from "@/features/conversations/conversation-types";
import { useWorkspaceStore } from "@/features/workspaces";

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
    autoClose
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
                    "flex items-center gap-1.5 text-xs transition-colors",
                    hasDropdown && !isPending
                        ? "cursor-pointer text-dark-200 hover:text-dark-200"
                        : "cursor-default text-dark-200"
                )}
            >
                <span className="size-3.5 shrink-0 text-dark-200">{icon}</span>
                <span
                    className={cn(
                        isPending ? "wave-text" : "text-dark-200 font-medium"
                    )}
                >
                    {label}
                </span>
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

            {expanded && children && (
                <div className="mt-1 max-h-48 overflow-y-auto">{children}</div>
            )}
        </div>
    );
}

// ─── Tool-specific blocks ─────────────────────────────────────────────────────

interface ReadFileInput {
    path?: string;
}

interface ReadFileOutput {
    path?: string;
    content?: string;
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

function formatLineRange(content?: string): string | null {
    if (typeof content !== "string") {
        return null;
    }

    const lineCount = countContentLines(content);

    if (lineCount <= 0) {
        return null;
    }

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
    resolvedPath: string | undefined,
    content: string | undefined,
    workspacePath?: string | null
): string | undefined {
    const pathLabel = formatReadPath(rawPath, resolvedPath, workspacePath);
    const lineRange = formatLineRange(content);

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
    const detail = formatReadDetail(
        inputPath,
        output?.path,
        output?.content,
        workspacePath
    );

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
}

interface GlobOutput {
    matches?: string[];
    matchCount?: number;
    truncated?: boolean;
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
}

interface GrepMatch {
    file?: string;
    line?: number;
    text?: string;
}

interface GrepOutput {
    matches?: GrepMatch[];
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
    const count =
        typeof output?.matchCount === "number"
            ? output.matchCount
            : Array.isArray(output?.matches)
              ? output.matches.length
              : undefined;
    const files = output?.filesMatched;

    if (pattern && typeof count === "number") {
        const suffix = output?.truncated ? "+" : "";
        const fileSuffix =
            typeof files === "number" && files > 0 ? ` in ${files} files` : "";
        return `${pattern} · ${count}${suffix}${fileSuffix}`;
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
    const matches = Array.isArray(output?.matches) ? output.matches : [];

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
            ) : matches.length > 0 ? (
                <ul className="flex flex-col gap-0.5 text-[11px] text-dark-200">
                    {matches.map((match, idx) => (
                        <li
                            key={`${match.file ?? ""}-${match.line ?? 0}-${idx}`}
                            className="truncate"
                        >
                            <span className="text-dark-200">
                                {match.file ?? "?"}:{match.line ?? "?"}
                            </span>
                            {match.text ? (
                                <>
                                    <span className="text-dark-300">: </span>
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
        default:
            return <GenericToolBlock invocation={invocation} />;
    }
}
