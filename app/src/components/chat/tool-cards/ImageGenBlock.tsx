import { ImageIcon } from "@phosphor-icons/react";
import type {
    ToolInvocation,
    ToolInvocationStatus
} from "@/features/conversations/conversation-types";
import { resolveAttachmentContentUrl } from "@/features/attachments";
import { usePaneWorkspaceId } from "@/features/split-panes";
import { ToolBlock } from "./shared/ToolBlock";
import { isRecord, truncate } from "./shared/format";

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

export function ImageGenBlock({ invocation }: { invocation: ToolInvocation }) {
    const paneWorkspaceId = usePaneWorkspaceId();
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
        paneWorkspaceId
            ? resolveAttachmentContentUrl(
                  paneWorkspaceId,
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
