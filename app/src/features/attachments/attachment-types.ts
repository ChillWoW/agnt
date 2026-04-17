export type AttachmentKind = "image" | "file";

export interface Attachment {
    id: string;
    conversation_id: string | null;
    message_id: string | null;
    file_name: string;
    mime_type: string;
    size_bytes: number;
    kind: AttachmentKind;
    created_at: string;
    estimated_tokens: number | null;
}

export interface PendingAttachment {
    localId: string;
    id: string | null;
    file_name: string;
    mime_type: string;
    size_bytes: number;
    kind: AttachmentKind;
    previewUrl: string | null;
    status: "uploading" | "ready" | "error";
    error?: string;
    estimated_tokens: number | null;
}
