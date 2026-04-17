import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { getWorkspaceDb } from "../../lib/db";
import { getHomePath } from "../../lib/homedir";
import { isKnownTextMime, looksLikeUtf8Text } from "../../lib/mime-detect";
import { countTokens } from "../../lib/tokenizer";

export type AttachmentKind = "image" | "file";

export interface AttachmentRow {
    id: string;
    conversation_id: string | null;
    message_id: string | null;
    file_name: string;
    mime_type: string;
    size_bytes: number;
    storage_path: string;
    kind: AttachmentKind;
    created_at: string;
    estimated_tokens: number | null;
}

export interface AttachmentDto {
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

const IMAGE_TOKEN_ESTIMATE = 1105;
const MAX_INLINE_TEXT_BYTES = 200_000;

function estimateTokensFromBytes(
    fileName: string,
    mime: string,
    bytes: Uint8Array
): number {
    const normalized = mime.toLowerCase();

    if (normalized.startsWith("image/")) {
        return IMAGE_TOKEN_ESTIMATE;
    }

    if (normalized === "application/pdf") {
        return Math.ceil(bytes.byteLength / 4);
    }

    if (!isKnownTextMime(normalized) && !looksLikeUtf8Text(bytes)) {
        return 0;
    }

    const slice =
        bytes.byteLength > MAX_INLINE_TEXT_BYTES
            ? bytes.subarray(0, MAX_INLINE_TEXT_BYTES)
            : bytes;

    let text: string;
    try {
        text = new TextDecoder("utf-8").decode(slice);
    } catch {
        return 0;
    }

    const filenameOverhead = countTokens(
        `Attached file: ${fileName}\n\n\`\`\`\n`
    );
    const fenceOverhead = 4;
    return countTokens(text) + filenameOverhead + fenceOverhead;
}

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

function attachmentsDir(workspaceId: string): string {
    return getHomePath("workspaces", workspaceId, "attachments");
}

function resolveStoragePath(workspaceId: string, relative: string): string {
    return join(attachmentsDir(workspaceId), relative);
}

function toDto(row: AttachmentRow): AttachmentDto {
    return {
        id: row.id,
        conversation_id: row.conversation_id,
        message_id: row.message_id,
        file_name: row.file_name,
        mime_type: row.mime_type,
        size_bytes: row.size_bytes,
        kind: row.kind,
        created_at: row.created_at,
        estimated_tokens: row.estimated_tokens
    };
}

function kindFromMime(mime: string): AttachmentKind {
    return mime.startsWith("image/") ? "image" : "file";
}

function ensureDir(dir: string): void {
    try {
        mkdirSync(dir, { recursive: true });
    } catch {
        // already exists
    }
}

export async function createAttachment(
    workspaceId: string,
    file: File
): Promise<AttachmentDto> {
    if (file.size > MAX_ATTACHMENT_BYTES) {
        throw new Error(
            `File too large (${file.size} bytes, max ${MAX_ATTACHMENT_BYTES})`
        );
    }

    const id = crypto.randomUUID();
    const rawName = file.name || "file";
    const ext = extname(rawName);
    const relative = `${id}${ext}`;
    const absolute = resolveStoragePath(workspaceId, relative);

    ensureDir(dirname(absolute));

    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    writeFileSync(absolute, bytes);

    const now = new Date().toISOString();
    const mime =
        file.type && file.type.length > 0
            ? file.type
            : "application/octet-stream";
    const kind = kindFromMime(mime);
    const estimatedTokens = estimateTokensFromBytes(rawName, mime, bytes);

    const db = getWorkspaceDb(workspaceId);
    db.query(
        `INSERT INTO attachments (id, conversation_id, message_id, file_name, mime_type, size_bytes, storage_path, kind, created_at, estimated_tokens)
         VALUES (?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
        id,
        rawName,
        mime,
        bytes.byteLength,
        relative,
        kind,
        now,
        estimatedTokens
    );

    return {
        id,
        conversation_id: null,
        message_id: null,
        file_name: rawName,
        mime_type: mime,
        size_bytes: bytes.byteLength,
        kind,
        created_at: now,
        estimated_tokens: estimatedTokens
    };
}

export function getAttachment(
    workspaceId: string,
    attachmentId: string
): AttachmentRow | null {
    const db = getWorkspaceDb(workspaceId);
    return (db
        .query(
            `SELECT id, conversation_id, message_id, file_name, mime_type, size_bytes, storage_path, kind, created_at, estimated_tokens
             FROM attachments WHERE id = ?`
        )
        .get(attachmentId) as AttachmentRow | null) ?? null;
}

export function getAttachmentDto(
    workspaceId: string,
    attachmentId: string
): AttachmentDto | null {
    const row = getAttachment(workspaceId, attachmentId);
    return row ? toDto(row) : null;
}

export function readAttachmentBytes(
    workspaceId: string,
    row: AttachmentRow
): Uint8Array {
    const absolute = resolveStoragePath(workspaceId, row.storage_path);
    const buf = readFileSync(absolute);
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

export function listAttachmentsForMessages(
    workspaceId: string,
    messageIds: string[]
): AttachmentDto[] {
    if (messageIds.length === 0) return [];
    const db = getWorkspaceDb(workspaceId);
    const placeholders = messageIds.map(() => "?").join(",");
    const rows = db
        .query(
            `SELECT id, conversation_id, message_id, file_name, mime_type, size_bytes, storage_path, kind, created_at, estimated_tokens
             FROM attachments WHERE message_id IN (${placeholders}) ORDER BY created_at ASC`
        )
        .all(...messageIds) as AttachmentRow[];
    return rows.map(toDto);
}

export function listAttachmentsForMessage(
    workspaceId: string,
    messageId: string
): AttachmentRow[] {
    const db = getWorkspaceDb(workspaceId);
    return db
        .query(
            `SELECT id, conversation_id, message_id, file_name, mime_type, size_bytes, storage_path, kind, created_at, estimated_tokens
             FROM attachments WHERE message_id = ? ORDER BY created_at ASC`
        )
        .all(messageId) as AttachmentRow[];
}

export function linkAttachmentsToMessage(
    workspaceId: string,
    attachmentIds: string[],
    conversationId: string,
    messageId: string
): AttachmentDto[] {
    if (attachmentIds.length === 0) return [];
    const db = getWorkspaceDb(workspaceId);
    const now = new Date().toISOString();

    const tx = db.transaction(() => {
        for (const id of attachmentIds) {
            const existing = db
                .query("SELECT id, message_id FROM attachments WHERE id = ?")
                .get(id) as { id: string; message_id: string | null } | null;

            if (!existing) {
                throw new Error(`Attachment not found: ${id}`);
            }

            if (existing.message_id && existing.message_id !== messageId) {
                throw new Error(`Attachment already linked: ${id}`);
            }

            db.query(
                `UPDATE attachments
                 SET conversation_id = ?, message_id = ?, created_at = COALESCE(created_at, ?)
                 WHERE id = ?`
            ).run(conversationId, messageId, now, id);
        }
    });

    tx();

    const placeholders = attachmentIds.map(() => "?").join(",");
    const rows = db
        .query(
            `SELECT id, conversation_id, message_id, file_name, mime_type, size_bytes, storage_path, kind, created_at, estimated_tokens
             FROM attachments WHERE id IN (${placeholders}) ORDER BY created_at ASC`
        )
        .all(...attachmentIds) as AttachmentRow[];
    return rows.map(toDto);
}

export function deleteAttachment(
    workspaceId: string,
    attachmentId: string
): void {
    const row = getAttachment(workspaceId, attachmentId);
    if (!row) {
        throw new Error(`Attachment not found: ${attachmentId}`);
    }

    const absolute = resolveStoragePath(workspaceId, row.storage_path);
    try {
        unlinkSync(absolute);
    } catch {
        // file may already be gone; proceed to delete the row
    }

    const db = getWorkspaceDb(workspaceId);
    db.query("DELETE FROM attachments WHERE id = ?").run(attachmentId);
}
