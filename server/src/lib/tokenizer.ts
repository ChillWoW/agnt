import { encode } from "gpt-tokenizer/encoding/o200k_base";

/**
 * Count the number of tokens in a string using the o200k_base encoding
 * (shared by GPT-4o and GPT-5.x families). Returns 0 for empty or
 * unencodable input rather than throwing, because the tokenizer runs on
 * the hot context-computation path and must never take down a stream.
 */
export function countTokens(text: string): number {
    if (!text) return 0;
    try {
        return encode(text).length;
    } catch {
        return Math.ceil(text.length / 4);
    }
}
