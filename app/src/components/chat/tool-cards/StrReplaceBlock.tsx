import { PencilLineIcon } from "@phosphor-icons/react";
import type { ToolInvocation } from "@/features/conversations/conversation-types";
import { useWorkspaceStore } from "@/features/workspaces";
import { usePaneWorkspaceId } from "@/features/split-panes";
import { PierreDiff } from "@/components/chat/PierreDiff";
import { ToolBlock } from "./shared/ToolBlock";
import { formatReadPath, isRecord } from "./shared/format";
import { extractPartialTopLevelStrings } from "./shared/partial-json";
import { PostEditDiagnostics } from "./shared/PostEditDiagnostics";

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

export function StrReplaceBlock({
    invocation
}: {
    invocation: ToolInvocation;
}) {
    const paneWorkspaceId = usePaneWorkspaceId();
    const workspacePath = useWorkspaceStore((state) => {
        const target = state.workspaces.find((w) => w.id === paneWorkspaceId);
        return target?.path ?? null;
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
                <>
                    <PierreDiff
                        path={diffPath}
                        oldContents={oldText}
                        newContents={newText}
                    />
                    <PostEditDiagnostics output={output} />
                </>
            ) : streaming ? (
                <p className="px-1 py-1 text-[11px] italic text-dark-400">
                    Streaming edit…
                </p>
            ) : null}
        </ToolBlock>
    );
}
