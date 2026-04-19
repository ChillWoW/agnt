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
 * user message when it contains @-mentions. The block forces the model to
 * inspect referenced paths via its read_file / glob / grep tools rather than
 * hallucinating their contents.
 */
export function buildMentionsInstructionBlock(
    mentions: MessageMention[]
): string {
    if (mentions.length === 0) return "";
    const lines = mentions.map((m) =>
        m.type === "directory"
            ? `- dir:  ${m.path}`
            : `- file: ${m.path}`
    );
    return [
        "<workspace_mentions>",
        "The user referenced these workspace paths. You MUST inspect them with your `read_file`, `glob`, and `grep` tools before answering. Do NOT assume their contents. Paths are relative to the workspace root.",
        ...lines,
        "</workspace_mentions>"
    ].join("\n");
}

export function estimateMentionsBlockTokens(
    mentions: MessageMention[]
): number {
    if (mentions.length === 0) return 0;
    return mentions.length * 10 + 40;
}
