import { Mark, mergeAttributes } from "@tiptap/core";

/**
 * A Tiptap Mark that visually highlights a leading `/<command>` token in
 * the editor. Using a Mark (NOT a Node like the mention chip) is intentional:
 *
 *   - The slash command must remain regular *editable text* — the user can
 *     backspace into it, retype, etc. Marks attach styling to text without
 *     turning it into an atomic widget.
 *   - When the editor serializes its content for sending, the marked text
 *     is preserved verbatim in the resulting plain text. The frontend's
 *     `extractLeadingSlashCommand` parser then strips it off the message
 *     before forwarding to the server.
 *
 * `inclusive: false` and `spanning: false` together prevent the mark from
 * "growing" when the user types right after the marked run — so typing
 * after `/plan ` doesn't accidentally turn the rest of the message yellow.
 */
export const SlashCommandMark = Mark.create({
    name: "slashCommand",
    inclusive: false,
    spanning: false,

    parseHTML() {
        return [
            {
                tag: "span.slash-command-token"
            }
        ];
    },

    renderHTML({ HTMLAttributes }) {
        return [
            "span",
            mergeAttributes(HTMLAttributes, { class: "slash-command-token" }),
            0
        ];
    }
});
