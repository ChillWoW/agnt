import {
    ArrowsOutSimpleIcon,
    DownloadSimpleIcon,
    XIcon
} from "@phosphor-icons/react";
import {
    Modal,
    ModalClose,
    ModalContent,
    ModalDescription,
    ModalTitle,
    ModalTrigger
} from "@/components/ui";
import {
    downloadAttachment,
    type Attachment
} from "@/features/attachments";
import { cn } from "@/lib/cn";
import { AttachmentChip } from "./AttachmentChip";

interface MessageAttachmentsProps {
    attachments: Attachment[];
    workspaceId: string;
    resolveUrl: (id: string) => string;
    isUser: boolean;
}

export function MessageAttachments({
    attachments,
    workspaceId,
    resolveUrl,
    isUser
}: MessageAttachmentsProps) {
    if (attachments.length === 0) return null;

    const images = attachments.filter((a) => a.kind === "image");
    const files = attachments.filter((a) => a.kind === "file");

    const handleDownload = (att: Attachment) => {
        void downloadAttachment(workspaceId, att.id, att.file_name).catch(
            () => {}
        );
    };

    return (
        <div
            className={cn(
                "mb-1 flex flex-col gap-1.5",
                isUser ? "items-end" : "items-start"
            )}
        >
            {images.length > 0 && (
                <div
                    className={cn(
                        "flex flex-wrap gap-1.5",
                        isUser ? "justify-end" : "justify-start"
                    )}
                >
                    {images.map((att) => (
                        <ImageThumbnail
                            key={att.id}
                            src={resolveUrl(att.id)}
                            alt={att.file_name}
                            onDownload={() => handleDownload(att)}
                        />
                    ))}
                </div>
            )}

            {files.length > 0 && (
                <div
                    className={cn(
                        "flex flex-wrap gap-1.5",
                        isUser ? "justify-end" : "justify-start"
                    )}
                >
                    {files.map((att) => (
                        <AttachmentChip
                            key={att.id}
                            name={att.file_name}
                            mimeType={att.mime_type}
                            kind="file"
                            sizeBytes={att.size_bytes}
                            onOpen={() => handleDownload(att)}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

function ImageThumbnail({
    src,
    alt,
    onDownload
}: {
    src: string;
    alt: string;
    onDownload: () => void;
}) {
    return (
        <Modal>
            <ModalTrigger className="block size-28 overflow-hidden rounded-md border border-dark-700 bg-dark-900 transition-colors hover:border-dark-500 focus-visible:border-dark-400">
                <img
                    src={src}
                    alt={alt}
                    loading="lazy"
                    className="size-full object-cover"
                />
            </ModalTrigger>

            <ModalContent className="max-w-5xl border-dark-600 bg-dark-950 p-0">
                <div className="flex items-center justify-between border-b border-dark-700 px-4 py-3">
                    <div className="min-w-0 pr-4">
                        <ModalTitle className="truncate text-sm font-medium text-dark-50">
                            {alt || "Image preview"}
                        </ModalTitle>
                        <ModalDescription className="mt-1 text-xs text-dark-200">
                            Attachment preview
                        </ModalDescription>
                    </div>

                    <div className="flex items-center gap-2">
                        <a
                            href={src}
                            target="_blank"
                            rel="noopener noreferrer"
                            referrerPolicy="no-referrer"
                            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-dark-700 px-3 text-sm text-dark-100 transition-colors hover:border-dark-500 hover:text-dark-50"
                        >
                            <ArrowsOutSimpleIcon
                                className="size-4"
                                weight="bold"
                            />
                            Open
                        </a>
                        <button
                            type="button"
                            onClick={onDownload}
                            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-dark-700 px-3 text-sm text-dark-100 transition-colors hover:border-dark-500 hover:text-dark-50"
                        >
                            <DownloadSimpleIcon
                                className="size-4"
                                weight="bold"
                            />
                            Download
                        </button>
                        <ModalClose
                            aria-label="Close image preview"
                            className="h-9 w-9 px-0 text-dark-100 hover:text-dark-50"
                        >
                            <XIcon className="size-4" weight="bold" />
                        </ModalClose>
                    </div>
                </div>

                <div className="max-h-[80vh] overflow-auto bg-dark-950 p-4 sm:p-6">
                    <img
                        src={src}
                        alt={alt}
                        className="mx-auto block h-auto max-h-[calc(80vh-3rem)] w-auto max-w-full rounded-sm"
                    />
                </div>
            </ModalContent>
        </Modal>
    );
}
