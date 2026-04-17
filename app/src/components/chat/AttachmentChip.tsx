import {
    FileIcon,
    FilePdfIcon,
    FileTextIcon,
    FileZipIcon,
    SpinnerGapIcon,
    WarningIcon,
    XIcon
} from "@phosphor-icons/react";
import type { ComponentType } from "react";
import { cn } from "@/lib/cn";

interface AttachmentChipProps {
    name: string;
    mimeType: string;
    kind: "image" | "file";
    sizeBytes?: number;
    previewUrl?: string | null;
    status?: "uploading" | "ready" | "error";
    error?: string;
    onRemove?: () => void;
    onOpen?: () => void;
    downloadHref?: string;
    className?: string;
}

function formatBytes(bytes: number | undefined): string {
    if (bytes == null) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type IconComponent = ComponentType<{ className?: string; weight?: "bold" | "regular" | "fill" }>;

function pickFileIcon(mimeType: string): IconComponent {
    if (mimeType.includes("pdf")) return FilePdfIcon;
    if (
        mimeType.startsWith("text/") ||
        mimeType.includes("json") ||
        mimeType.includes("xml") ||
        mimeType.includes("yaml") ||
        mimeType.includes("markdown") ||
        mimeType.includes("javascript") ||
        mimeType.includes("typescript")
    )
        return FileTextIcon;
    if (mimeType.includes("zip") || mimeType.includes("compressed"))
        return FileZipIcon;
    return FileIcon;
}

export function AttachmentChip({
    name,
    mimeType,
    kind,
    sizeBytes,
    previewUrl,
    status = "ready",
    error,
    onRemove,
    onOpen,
    downloadHref,
    className
}: AttachmentChipProps) {
    const isImage = kind === "image" && previewUrl;
    const isError = status === "error";
    const isUploading = status === "uploading";
    const Icon = pickFileIcon(mimeType);

    if (isImage) {
        const content = (
            <>
                <img
                    src={previewUrl!}
                    alt={name}
                    className={cn(
                        "size-full object-cover",
                        isUploading && "opacity-60"
                    )}
                />
                {isUploading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-dark-950/40">
                        <SpinnerGapIcon
                            className="size-4 animate-spin text-dark-50"
                            weight="bold"
                        />
                    </div>
                )}
                {isError && (
                    <div className="absolute inset-0 flex items-center justify-center bg-red-500/20">
                        <WarningIcon
                            className="size-4 text-red-400"
                            weight="fill"
                        />
                    </div>
                )}
            </>
        );

        return (
            <div
                className={cn(
                    "group relative shrink-0 overflow-hidden rounded-md border bg-dark-800",
                    isError ? "border-red-500/40" : "border-dark-700",
                    "size-14",
                    className
                )}
                title={error ?? `${name} (${formatBytes(sizeBytes)})`}
            >
                {onOpen ? (
                    <button
                        type="button"
                        onClick={onOpen}
                        className="block size-full"
                    >
                        {content}
                    </button>
                ) : (
                    <div className="block size-full">{content}</div>
                )}

                {onRemove && (
                    <button
                        type="button"
                        onClick={onRemove}
                        aria-label={`Remove ${name}`}
                        className="absolute right-0.5 top-0.5 flex size-4 items-center justify-center rounded-full bg-dark-950/80 text-dark-50 opacity-0 transition-opacity hover:bg-dark-900 group-hover:opacity-100"
                    >
                        <XIcon className="size-2.5" weight="bold" />
                    </button>
                )}
            </div>
        );
    }

    const body = (
        <div className="flex min-w-0 items-center gap-2 pr-2">
            <div
                className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded bg-dark-850 text-dark-100",
                    isError && "bg-red-500/10 text-red-400"
                )}
            >
                {isUploading ? (
                    <SpinnerGapIcon
                        className="size-4 animate-spin"
                        weight="bold"
                    />
                ) : (
                    <Icon className="size-4" weight="regular" />
                )}
            </div>
            <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium text-dark-50">
                    {name}
                </div>
                <div className="truncate text-[10px] text-dark-300">
                    {isError
                        ? (error ?? "Upload failed")
                        : isUploading
                          ? "Uploading..."
                          : formatBytes(sizeBytes)}
                </div>
            </div>
        </div>
    );

    const containerClass = cn(
        "group relative flex min-w-[11rem] max-w-[16rem] shrink-0 items-center gap-2 rounded-md border bg-dark-850 py-1.5 pl-1.5 pr-2",
        isError ? "border-red-500/40" : "border-dark-700",
        className
    );

    return (
        <div className={containerClass} title={error ?? name}>
            {onOpen && !onRemove ? (
                <button
                    type="button"
                    onClick={onOpen}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                    {body}
                </button>
            ) : downloadHref && !onRemove ? (
                <a
                    href={downloadHref}
                    download={name}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                    {body}
                </a>
            ) : (
                <div className="flex min-w-0 flex-1 items-center gap-2">{body}</div>
            )}

            {onRemove && (
                <button
                    type="button"
                    onClick={onRemove}
                    aria-label={`Remove ${name}`}
                    className="flex size-5 shrink-0 items-center justify-center rounded text-dark-200 transition-colors hover:bg-dark-800 hover:text-dark-50"
                >
                    <XIcon className="size-3" weight="bold" />
                </button>
            )}
        </div>
    );
}
