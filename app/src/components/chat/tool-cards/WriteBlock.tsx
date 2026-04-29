import { NotePencilIcon } from "@phosphor-icons/react";
import type { ToolInvocation } from "@/features/conversations/conversation-types";
import { useWorkspaceStore } from "@/features/workspaces";
import { usePaneWorkspaceId } from "@/features/split-panes";
import { PierreDiff } from "@/components/chat/PierreDiff";
import { ToolBlock } from "./shared/ToolBlock";
import {
    formatByteCount,
    formatReadPath,
    isRecord
} from "./shared/format";
import { extractPartialTopLevelStrings } from "./shared/partial-json";
import { PostEditDiagnostics } from "./shared/PostEditDiagnostics";

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

export function WriteBlock({ invocation }: { invocation: ToolInvocation }) {
    const paneWorkspaceId = usePaneWorkspaceId();
    const workspacePath = useWorkspaceStore((state) => {
        const target = state.workspaces.find((w) => w.id === paneWorkspaceId);
        return target?.path ?? null;
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
                <>
                    <PierreDiff
                        path={diffPath}
                        oldContents=""
                        newContents={previewSource}
                    />
                    <PostEditDiagnostics output={output} />
                </>
            ) : streaming ? (
                <p className="px-1 py-1 text-[11px] italic text-dark-400">
                    Streaming file contents…
                </p>
            ) : null}
        </ToolBlock>
    );
}
