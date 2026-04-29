import { FileTextIcon } from "@phosphor-icons/react";
import type { ToolInvocation } from "@/features/conversations/conversation-types";
import { useWorkspaceStore } from "@/features/workspaces";
import { usePaneWorkspaceId } from "@/features/split-panes";
import { ToolBlock } from "./shared/ToolBlock";
import { formatReadPath, isRecord } from "./shared/format";

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

export function ReadFileBlock({ invocation }: { invocation: ToolInvocation }) {
    const paneWorkspaceId = usePaneWorkspaceId();
    const workspacePath = useWorkspaceStore((state) => {
        const target = state.workspaces.find((w) => w.id === paneWorkspaceId);
        return target?.path ?? null;
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
