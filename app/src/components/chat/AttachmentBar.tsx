import type { PendingAttachment } from "@/features/attachments";
import { AttachmentChip } from "./AttachmentChip";

interface AttachmentBarProps {
    attachments: PendingAttachment[];
    onRemove: (localId: string) => void;
}

export function AttachmentBar({ attachments, onRemove }: AttachmentBarProps) {
    if (attachments.length === 0) return null;

    return (
        <div className="border-b border-dark-700 px-2.5 py-2">
            <div className="flex gap-2 overflow-x-auto hide-scrollbar">
                {attachments.map((att) => (
                    <AttachmentChip
                        key={att.localId}
                        name={att.file_name}
                        mimeType={att.mime_type}
                        kind={att.kind}
                        sizeBytes={att.size_bytes}
                        previewUrl={att.previewUrl}
                        status={att.status}
                        error={att.error}
                        onRemove={() => onRemove(att.localId)}
                    />
                ))}
            </div>
        </div>
    );
}
