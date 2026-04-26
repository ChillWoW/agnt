/**
 * Matches a leading slash command at the very start of the input (allowing
 * leading whitespace). The command itself is `/[a-zA-Z][a-zA-Z0-9_-]*` and
 * is followed either by whitespace or end-of-input.
 *
 *   `/plan`            -> { command: "plan", rest: "" }
 *   `/plan tighten X`  -> { command: "plan", rest: "tighten X" }
 *   `  /find-skills`   -> { command: "find-skills", rest: "" }
 *   `hello /plan`      -> { command: null,    rest: "hello /plan" }
 */
const LEADING_SLASH_RE = /^\s*\/([a-zA-Z][\w-]*)(?:\s+|$)/;

export interface LeadingSlashCommand {
    /** Lowercased command name without the leading `/`, or null if none. */
    command: string | null;
    /** The remainder of the input after the command (trimmed). */
    rest: string;
}

export function extractLeadingSlashCommand(text: string): LeadingSlashCommand {
    if (!text) return { command: null, rest: "" };

    const match = text.match(LEADING_SLASH_RE);
    if (!match) {
        return { command: null, rest: text };
    }

    const command = match[1].toLowerCase();
    const rest = text.slice(match[0].length).trimStart();
    return { command, rest };
}
