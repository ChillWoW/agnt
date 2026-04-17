import { encode } from "gpt-tokenizer/encoding/o200k_base";

/**
 * Count tokens client-side for live meter estimation of the unsent draft.
 * Uses the o200k_base encoding (GPT-4o/GPT-5.x). Returns 0 on failure so
 * the meter never throws during typing.
 */
export function countTokens(text: string): number {
    if (!text) return 0;
    try {
        return encode(text).length;
    } catch {
        return Math.ceil(text.length / 4);
    }
}
