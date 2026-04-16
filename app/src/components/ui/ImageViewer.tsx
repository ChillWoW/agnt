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
} from "./Modal";

interface ImageViewerProps {
    src: string;
    alt: string;
}

export function ImageViewer({ src, alt }: ImageViewerProps) {
    return (
        <Modal>
            <ModalTrigger className="group my-3 block w-full overflow-hidden rounded-md border border-dark-700 bg-dark-900 text-left transition-colors hover:border-dark-500 focus-visible:border-dark-400">
                <img
                    src={src}
                    alt={alt}
                    loading="lazy"
                    className="max-h-96 w-full object-cover transition-opacity group-hover:opacity-95"
                />
            </ModalTrigger>

            <ModalContent className="max-w-5xl border-dark-600 bg-dark-950 p-0">
                <div className="flex items-center justify-between border-b border-dark-700 px-4 py-3">
                    <div className="min-w-0 pr-4">
                        <ModalTitle className="truncate text-sm font-medium text-dark-50">
                            {alt || "Image preview"}
                        </ModalTitle>
                        <ModalDescription className="mt-1 text-xs text-dark-200">
                            Previewing inline markdown image
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
                            <ArrowsOutSimpleIcon className="size-4" weight="bold" />
                            Open
                        </a>
                        <a
                            href={src}
                            download
                            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-dark-700 px-3 text-sm text-dark-100 transition-colors hover:border-dark-500 hover:text-dark-50"
                        >
                            <DownloadSimpleIcon className="size-4" weight="bold" />
                            Download
                        </a>
                        <ModalClose aria-label="Close image preview" className="h-9 w-9 px-0 text-dark-100 hover:text-dark-50">
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
