import { FileTextIcon, WrenchIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import type { ToolInvocation } from "@/features/conversations/conversation-types";

// ─── Universal primitive ──────────────────────────────────────────────────────

interface ToolBlockProps {
    icon: React.ReactNode;
    pendingLabel: string;
    doneLabel: string;
    detail?: string;
    status: ToolInvocation["status"];
}

function ToolBlock({
    icon,
    pendingLabel,
    doneLabel,
    detail,
    status
}: ToolBlockProps) {
    const isPending = status === "pending";
    const label = isPending ? pendingLabel : doneLabel;

    return (
        <div className="flex items-center gap-1.5 text-xs">
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
