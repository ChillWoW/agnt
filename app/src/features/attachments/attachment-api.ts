import { api, resolveAuthHeaders, resolveBaseUrl } from "@/lib/api";
import type { Attachment } from "./attachment-types";

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export function uploadAttachment(
    workspaceId: string,
    file: File,
    signal?: AbortSignal
): Promise<Attachment> {
    const form = new FormData();
    form.append("file", file, file.name);

    return api.post<Attachment>(`/workspaces/${workspaceId}/attachments`, {
        body: form,
        signal
    });
}

export function deleteAttachment(workspaceId: string, attachmentId: string) {
    return api.delete<{ success: boolean }>(
        `/workspaces/${workspaceId}/attachments/${attachmentId}`
    );
}

export function resolveAttachmentContentUrl(
    workspaceId: string,
    attachmentId: string
): string {
    return `${resolveBaseUrl()}/workspaces/${workspaceId}/attachments/${attachmentId}/content`;
}

export async function downloadAttachment(
    workspaceId: string,
    attachmentId: string,
    fileName: string
): Promise<void> {
    const url = resolveAttachmentContentUrl(workspaceId, attachmentId);
    const response = await fetch(url, { headers: resolveAuthHeaders() });

    if (!response.ok) {
        throw new Error(
            `Failed to download attachment (status ${response.status})`
        );
    }

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);

    try {
        const anchor = document.createElement("a");
        anchor.href = objectUrl;
        anchor.download = fileName || "download";
        anchor.rel = "noopener";
        anchor.style.display = "none";
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
    } finally {
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    }
}
