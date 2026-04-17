import { useState, useEffect, useRef } from "react";
import {
    CaretRightIcon,
    FileTextIcon,
    WrenchIcon
} from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import type {
    ToolInvocation,
    ToolInvocationStatus
} from "@/features/conversations/conversation-types";

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

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function ReadFileBlock({ invocation }: { invocation: ToolInvocation }) {
    const path =
        isRecord(invocation.input) &&
        typeof (invocation.input as ReadFileInput).path === "string"
            ? (invocation.input as ReadFileInput).path
            : undefined;

    return (
        <ToolBlock
            icon={<FileTextIcon className="size-3.5" weight="bold" />}
            pendingLabel="Reading"
            successLabel="Read"
            errorLabel="Read failed"
            deniedLabel="Read denied"
            detail={path}
            error={invocation.error}
            status={invocation.status}
        />
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
        default:
            return <GenericToolBlock invocation={invocation} />;
    }
}
