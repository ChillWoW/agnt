import { useCallback, useEffect, useRef, useState } from "react";
import {
    MAX_ATTACHMENT_BYTES,
    deleteAttachment,
    uploadAttachment
} from "./attachment-api";
import type { PendingAttachment } from "./attachment-types";

interface UsePendingAttachmentsResult {
    pending: PendingAttachment[];
    isUploading: boolean;
    hasErrors: boolean;
    addFiles: (files: Iterable<File>) => void;
    remove: (localId: string) => void;
    clear: () => void;
    takeReadyIds: () => string[];
}

function kindFromMime(mime: string): "image" | "file" {
    return mime.startsWith("image/") ? "image" : "file";
}

export function usePendingAttachments(
    workspaceId: string | null | undefined
): UsePendingAttachmentsResult {
    const [pending, setPending] = useState<PendingAttachment[]>([]);
    const abortersRef = useRef<Map<string, AbortController>>(new Map());
    const objectUrlsRef = useRef<Map<string, string>>(new Map());
    const workspaceIdRef = useRef<string | null>(workspaceId ?? null);

    useEffect(() => {
        workspaceIdRef.current = workspaceId ?? null;
    }, [workspaceId]);

    const revokeUrl = useCallback((localId: string) => {
        const url = objectUrlsRef.current.get(localId);
        if (url) {
            URL.revokeObjectURL(url);
            objectUrlsRef.current.delete(localId);
        }
    }, []);

    const addFiles = useCallback(
        (files: Iterable<File>) => {
            const ws = workspaceIdRef.current;
            if (!ws) return;

            const fileArray = Array.from(files).filter(
                (file) => file instanceof File && file.size > 0
            );
            if (fileArray.length === 0) return;

            const newEntries: Array<{ entry: PendingAttachment; file: File }> = [];

            for (const file of fileArray) {
                const localId =
                    typeof crypto !== "undefined" && "randomUUID" in crypto
                        ? crypto.randomUUID()
                        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

                const mime = file.type || "application/octet-stream";
                const kind = kindFromMime(mime);

                let previewUrl: string | null = null;
                if (kind === "image") {
                    try {
                        previewUrl = URL.createObjectURL(file);
                        objectUrlsRef.current.set(localId, previewUrl);
                    } catch {
                        previewUrl = null;
                    }
                }

                const tooLarge = file.size > MAX_ATTACHMENT_BYTES;

                const entry: PendingAttachment = {
                    localId,
                    id: null,
                    file_name: file.name || "file",
                    mime_type: mime,
                    size_bytes: file.size,
                    kind,
                    previewUrl,
                    status: tooLarge ? "error" : "uploading",
                    error: tooLarge
                        ? `File too large (max ${Math.floor(MAX_ATTACHMENT_BYTES / (1024 * 1024))} MB)`
                        : undefined
                };

                newEntries.push({ entry, file });
            }

            setPending((prev) => [...prev, ...newEntries.map((n) => n.entry)]);

            for (const { entry, file } of newEntries) {
                if (entry.status === "error") continue;

                const controller = new AbortController();
                abortersRef.current.set(entry.localId, controller);

                uploadAttachment(ws, file, controller.signal)
                    .then((uploaded) => {
                        abortersRef.current.delete(entry.localId);
                        setPending((curr) =>
                            curr.map((item) =>
                                item.localId === entry.localId
                                    ? {
                                          ...item,
                                          id: uploaded.id,
                                          status: "ready",
                                          mime_type: uploaded.mime_type,
                                          size_bytes: uploaded.size_bytes,
                                          kind: uploaded.kind
                                      }
                                    : item
                            )
                        );
                    })
                    .catch((error: unknown) => {
                        abortersRef.current.delete(entry.localId);
                        if (
                            error instanceof DOMException &&
                            error.name === "AbortError"
                        ) {
                            return;
                        }
                        setPending((curr) =>
                            curr.map((item) =>
                                item.localId === entry.localId
                                    ? {
                                          ...item,
                                          status: "error",
                                          error:
                                              error instanceof Error
                                                  ? error.message
                                                  : "Upload failed"
                                      }
                                    : item
                            )
                        );
                    });
            }
        },
        []
    );

    const remove = useCallback(
        (localId: string) => {
            const aborter = abortersRef.current.get(localId);
            if (aborter) {
                aborter.abort();
                abortersRef.current.delete(localId);
            }
            revokeUrl(localId);

            setPending((prev) => {
                const target = prev.find((p) => p.localId === localId);
                const next = prev.filter((p) => p.localId !== localId);

                const ws = workspaceIdRef.current;
                if (target?.id && ws) {
                    void deleteAttachment(ws, target.id).catch(() => {});
                }

                return next;
            });
        },
        [revokeUrl]
    );

    const clear = useCallback(() => {
        for (const controller of abortersRef.current.values()) {
            controller.abort();
        }
        abortersRef.current.clear();

        for (const url of objectUrlsRef.current.values()) {
            URL.revokeObjectURL(url);
        }
        objectUrlsRef.current.clear();

        setPending([]);
    }, []);

    const takeReadyIds = useCallback(() => {
        return pending
            .filter((p): p is PendingAttachment & { id: string } =>
                p.status === "ready" && typeof p.id === "string"
            )
            .map((p) => p.id);
    }, [pending]);

    useEffect(() => {
        return () => {
            for (const controller of abortersRef.current.values()) {
                controller.abort();
            }
            abortersRef.current.clear();
            for (const url of objectUrlsRef.current.values()) {
                URL.revokeObjectURL(url);
            }
            objectUrlsRef.current.clear();
        };
    }, []);

    const isUploading = pending.some((p) => p.status === "uploading");
    const hasErrors = pending.some((p) => p.status === "error");

    return {
        pending,
        isUploading,
        hasErrors,
        addFiles,
        remove,
        clear,
        takeReadyIds
    };
}
