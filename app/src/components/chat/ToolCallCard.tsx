import { useState } from "react";
import {
    CaretRightIcon,
    CheckIcon,
    CircleNotchIcon,
    FileTextIcon,
    WarningIcon,
    WrenchIcon
} from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import type { ToolInvocation } from "@/features/conversations/conversation-types";

interface ToolCallCardProps {
    invocation: ToolInvocation;
}

interface ReadFileInput {
    path?: string;
    maxBytes?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function summarizeInput(
    toolName: string,
    input: unknown
): { label: string; summary: string } {
    if (toolName === "read_file" && isRecord(input)) {
        const typed = input as ReadFileInput;
        return {
            label: "read_file",
            summary: typeof typed.path === "string" ? typed.path : "…"
        };
    }
    return {
        label: toolName,
        summary: ""
    };
}

function prettyJson(value: unknown): string {
    if (value == null) return "";
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}

function StatusIcon({ status }: { status: ToolInvocation["status"] }) {
    if (status === "pending") {
        return (
            <CircleNotchIcon
                className="size-3 animate-spin text-dark-200"
                weight="bold"
            />
        );
    }
    if (status === "error") {
        return <WarningIcon className="size-3 text-dark-100" weight="bold" />;
    }
    return <CheckIcon className="size-3 text-dark-100" weight="bold" />;
}

function ToolIcon({ toolName }: { toolName: string }) {
    if (toolName === "read_file") {
        return <FileTextIcon className="size-3.5 text-dark-100" weight="bold" />;
    }
    return <WrenchIcon className="size-3.5 text-dark-100" weight="bold" />;
}

export function ToolCallCard({ invocation }: ToolCallCardProps) {
    const [expanded, setExpanded] = useState(false);
    const { label, summary } = summarizeInput(
        invocation.tool_name,
        invocation.input
    );

    const statusText =
        invocation.status === "pending"
            ? "Running"
            : invocation.status === "error"
              ? "Failed"
              : "Done";

    const outputPreview =
        invocation.status === "error"
            ? invocation.error ?? "Tool execution failed"
            : prettyJson(invocation.output);

    return (
        <div className="my-2 overflow-hidden rounded-md border border-dark-600 bg-dark-900 text-[12px]">
            <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-dark-850"
            >
                <CaretRightIcon
                    className={cn(
                        "size-3 shrink-0 text-dark-200 transition-transform",
                        expanded && "rotate-90"
                    )}
                    weight="bold"
                />
                <ToolIcon toolName={invocation.tool_name} />
                <span className="font-medium text-dark-50">{label}</span>
                {summary && (
                    <span
                        className="min-w-0 flex-1 truncate font-mono text-[11px] text-dark-200"
                        title={summary}
                    >
                        {summary}
                    </span>
                )}
                <span className="ml-auto flex items-center gap-1 text-[11px] text-dark-200">
                    <StatusIcon status={invocation.status} />
                    <span>{statusText}</span>
                </span>
            </button>

            {expanded && (
                <div className="border-t border-dark-600 bg-dark-950 px-2.5 py-2 font-mono text-[11px]">
                    <div className="mb-1 text-dark-300">input</div>
                    <pre className="mb-3 whitespace-pre-wrap break-all text-dark-100">
                        {prettyJson(invocation.input) || "{}"}
                    </pre>
                    <div className="mb-1 text-dark-300">
                        {invocation.status === "error" ? "error" : "output"}
                    </div>
                    <pre
                        className={cn(
                            "max-h-64 overflow-auto whitespace-pre-wrap break-all",
                            invocation.status === "error"
                                ? "text-dark-50"
                                : "text-dark-100"
                        )}
                    >
                        {invocation.status === "pending"
                            ? "…"
                            : outputPreview || "(empty)"}
                    </pre>
                </div>
            )}
        </div>
    );
}
