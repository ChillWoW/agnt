import type { MessageMention } from "./conversations.types";

const MENTION_PATTERN = /(?:^|[\s(\[{])@([A-Za-z0-9_./\\\-]+\/?)/g;

/**
 * Parse `@path` tokens out of a user-authored message.
 *
 * The editor serialises mentions as `@path/to/file.ts` for files and
 * `@path/to/folder/` (trailing slash) for directories. This function reverses
 * that serialisation so downstream code can derive a structured list of
 * mentions even when we only have the stored message text.
 */
export function parseMentionsFromContent(content: string): MessageMention[] {
    if (!content || content.length === 0) return [];

    const mentions: MessageMention[] = [];
    const seen = new Set<string>();

    let match: RegExpExecArray | null;
    const pattern = new RegExp(MENTION_PATTERN.source, "g");
    while ((match = pattern.exec(content)) !== null) {
        const raw = match[1];
        if (!raw) continue;

        let path = raw;
        let type: MessageMention["type"] = "file";
        if (path.endsWith("/")) {
            type = "directory";
            path = path.slice(0, -1);
        }

        if (path.length === 0) continue;
        const key = `${type}:${path}`;
        if (seen.has(key)) continue;
        seen.add(key);

        mentions.push({ path, type });
    }

    return mentions;
}

/**
 * Build the `<workspace_mentions>` instruction block that is prepended to the
 * user message when it contains @-mentions of *directories*.
 *
 * NOTE: File mentions are intentionally excluded here — the stream layer
 * eagerly invokes `read_file` for each mentioned file (mirroring the slash-
 * skill flow that pre-loads `SKILL.md` bodies) and emits a synthetic
 * `read_file` tool invocation per file, so the model already sees the file
 * contents through its tool-call replay. Re-listing files in this block
 * would just nudge the model to re-read what it already has.
 *
 * Directories don't fit the eager-load pattern (size unbounded; "reading"
 * a folder isn't a single tool call), so we keep the instruction nudge for
 * them: the model is reminded to use `glob` / `grep` / `read_file` to
 * inspect referenced folders.
 */
export function buildMentionsInstructionBlock(
    mentions: MessageMention[]
): string {
    const dirs = mentions.filter((m) => m.type === "directory");
    if (dirs.length === 0) return "";
    const lines = dirs.map((m) => `- dir:  ${m.path}`);
    return [
        "<workspace_mentions>",
        "The user referenced these workspace directories. You MUST inspect them with your `glob`, `grep`, and `read_file` tools before answering. Do NOT assume their contents. Paths are relative to the workspace root.",
        ...lines,
        "</workspace_mentions>"
    ].join("\n");
}

export function estimateMentionsBlockTokens(
    mentions: MessageMention[]
): number {
    const dirs = mentions.filter((m) => m.type === "directory");
    if (dirs.length === 0) return 0;
    return dirs.length * 10 + 40;
}
