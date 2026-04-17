import { useState, useEffect, useRef } from "react";
import { CaretDownIcon, FileTextIcon, WrenchIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import type { ToolInvocation, ToolInvocationStatus } from "@/features/conversations/conversation-types";

// ─── Universal primitive ──────────────────────────────────────────────────────

interface ToolBlockProps {
    icon: React.ReactNode;
    pendingLabel: string;
    doneLabel: string;
    detail?: string;
    status: ToolInvocationStatus;
    children?: React.ReactNode;
    autoOpen?: boolean;
    autoClose?: boolean;
}

export function ToolBlock({
    icon,
    pendingLabel,
    doneLabel,
    detail,
    status,
    children,
    autoOpen,
    autoClose
}: ToolBlockProps) {
    const isPending = status === "pending";
    const label = isPending ? pendingLabel : doneLabel;
    const hasDropdown = !!children;

    const [expanded, setExpanded] = useState(() => !!(autoOpen && isPending));
    const prevPendingRef = useRef(isPending);

    useEffect(() => {
        const wasPending = prevPendingRef.current;
        prevPendingRef.current = isPending;

        if (isPending && !wasPending && autoOpen) {
            setExpanded(true);
        } else if (!isPending && wasPending && autoClose) {
            setExpanded(false);
        }
    }, [isPending, autoOpen, autoClose]);

    return (
        <div className="mb-2">
            <button
                type="button"
                onClick={() => hasDropdown && !isPending && setExpanded((v) => !v)}
                className={cn(
                    "flex items-center gap-1.5 text-xs transition-colors",
                    hasDropdown && !isPending
                        ? "cursor-pointer text-dark-300 hover:text-dark-200"
                        : "cursor-default"
                )}
            >
                <span className="text-dark-200">{icon}</span>
                <span
                    className={cn(
                        isPending ? "wave-text" : "text-dark-200 font-medium"
                    )}
                >
                    {label}
                </span>
                {detail && (
                    <span className="min-w-0 truncate text-dark-300" title={detail}>
                        {detail}
                    </span>
                )}
                {hasDropdown && !isPending && (
                    <CaretDownIcon
                        className={cn(
                            "size-3 shrink-0 transition-transform",
                            expanded && "rotate-180"
                        )}
                        weight="bold"
                    />
                )}
            </button>

            {expanded && children && (
                <div className="ml-5 mt-1 max-h-48 overflow-y-auto border-l border-dark-600 pl-2.5 py-0.5">
                    {children}
                </div>
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
            doneLabel="Read"
            detail={path}
            status={invocation.status}
        />
    );
}

function GenericToolBlock({ invocation }: { invocation: ToolInvocation }) {
    return (
        <ToolBlock
            icon={<WrenchIcon className="size-3.5" weight="bold" />}
            pendingLabel={invocation.tool_name}
            doneLabel={invocation.tool_name}
            status={invocation.status}
        />
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
