import { Elysia } from "elysia";
import {
    createAttachment,
    deleteAttachment,
    getAttachment,
    MAX_ATTACHMENT_BYTES,
    readAttachmentBytes
} from "./attachments.service";

const attachmentsRoutes = new Elysia({ prefix: "/workspaces" })
    .post("/:id/attachments", async ({ params, request, set }) => {
        try {
            const contentType = request.headers.get("content-type") ?? "";
            if (!contentType.includes("multipart/form-data")) {
                set.status = 400;
                return { error: "Expected multipart/form-data" };
            }

            const formData = await request.formData();
            const file = formData.get("file");

            if (!(file instanceof File)) {
                set.status = 400;
                return { error: "Missing 'file' field" };
            }

            if (file.size === 0) {
                set.status = 400;
                return { error: "File is empty" };
            }

            if (file.size > MAX_ATTACHMENT_BYTES) {
                set.status = 413;
                return {
                    error: `File too large. Max ${MAX_ATTACHMENT_BYTES} bytes.`
                };
            }

            const attachment = await createAttachment(params.id, file);
            return attachment;
        } catch (error) {
            set.status = 400;
            return {
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to upload attachment"
            };
        }
    })
    .get(
        "/:id/attachments/:attachmentId/content",
        ({ params, set }) => {
            const row = getAttachment(params.id, params.attachmentId);
            if (!row) {
                set.status = 404;
                return { error: "Attachment not found" };
            }

            try {
                const bytes = readAttachmentBytes(params.id, row);
                set.headers["Content-Type"] = row.mime_type;
                set.headers["Content-Length"] = String(bytes.byteLength);
                set.headers["Content-Disposition"] =
                    `inline; filename="${encodeURIComponent(row.file_name)}"`;
                return new Response(bytes, {
                    status: 200,
                    headers: {
                        "Content-Type": row.mime_type,
                        "Content-Length": String(bytes.byteLength)
                    }
                });
            } catch (error) {
                set.status = 500;
                return {
                    error:
                        error instanceof Error
                            ? error.message
                            : "Failed to read attachment"
                };
            }
        }
    )
    .delete("/:id/attachments/:attachmentId", ({ params, set }) => {
        try {
            deleteAttachment(params.id, params.attachmentId);
            return { success: true };
        } catch (error) {
            set.status = 404;
            return {
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to delete attachment"
            };
        }
    });

export default attachmentsRoutes;
