import { logger } from "../../lib/logger";
import { isKnownTextMime, looksLikeUtf8Text } from "../../lib/mime-detect";
import { countTokens } from "../../lib/tokenizer";
import {
    readAttachmentBytes,
    type AttachmentRow
} from "../attachments/attachments.service";

/**
 * Fixed per-image token budget. OpenAI's vision pricing heuristic gives
 * roughly 1105 tokens for a single 1024x1024 tile in "high" detail mode,
 * which is a safe first-order estimate for any image that doesn't blow up
 * the context meter. Upgraded later if we decide to actually size images.
 */
const IMAGE_TOKEN_ESTIMATE = 1105;

/**
 * Matches the 200KB truncation applied by buildModelMessages in
 * conversation.stream.ts so the meter reflects what actually gets sent.
 */
const MAX_INLINE_TEXT_BYTES = 200_000;

/**
 * Estimate how many tokens an attachment will contribute once encoded for
 * the model. Must stay in lockstep with encodeAttachmentForModel in
 * conversation.stream.ts so the meter doesn't drift from reality.
 *
 * Image -> fixed IMAGE_TOKEN_ESTIMATE.
 * PDF -> ceil(size_bytes / 4) (rough upper bound, per plan).
 * Text-decodable -> tokenize the truncated decoded text.
 * Anything else -> 0 (skipped by the encoder too).
 */
export function estimateAttachmentTokens(
    workspaceId: string,
    row: AttachmentRow
): number {
    const mime = row.mime_type.toLowerCase();

    if (mime.startsWith("image/")) {
        return IMAGE_TOKEN_ESTIMATE;
    }

    if (mime === "application/pdf") {
        return Math.ceil(row.size_bytes / 4);
    }

    let bytes: Uint8Array;
    try {
        bytes = readAttachmentBytes(workspaceId, row);
    } catch (error) {
        logger.error(
            "[context.attachments] Failed to read attachment bytes",
            { id: row.id, path: row.storage_path },
            error
        );
        return 0;
    }

    if (!isKnownTextMime(mime) && !looksLikeUtf8Text(bytes)) {
        return 0;
    }

    const truncated = bytes.byteLength > MAX_INLINE_TEXT_BYTES;
    const slice = truncated
        ? bytes.subarray(0, MAX_INLINE_TEXT_BYTES)
        : bytes;

    let text: string;
    try {
        text = new TextDecoder("utf-8").decode(slice);
    } catch {
        return 0;
    }

    const filenameOverhead = countTokens(
        `Attached file: ${row.file_name}\n\n\`\`\`\n`
    );
    const fenceOverhead = 4;
    return countTokens(text) + filenameOverhead + fenceOverhead;
}
