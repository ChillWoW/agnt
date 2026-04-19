import Mention from "@tiptap/extension-mention";
import type { MentionEntryType } from "@/features/workspaces";

export interface MentionNodeAttrs {
    id: string;
    label: string;
    type: MentionEntryType;
}

export function serializeMentionLabel(attrs: MentionNodeAttrs): string {
    const path = attrs.id;
    if (attrs.type === "directory") {
        return path.endsWith("/") ? `@${path}` : `@${path}/`;
    }
    return `@${path}`;
}

/**
 * Extends the default Mention node with an extra `type` attribute
 * (`"file" | "directory"`) so we can distinguish files from folders when
 * serialising the editor content.
 */
export const MentionExtension = Mention.extend({
    addAttributes() {
        return {
            id: {
                default: null,
                parseHTML: (element) => element.getAttribute("data-id"),
                renderHTML: (attributes) => {
                    if (!attributes.id) return {};
                    return { "data-id": attributes.id };
                }
            },
            label: {
                default: null,
                parseHTML: (element) => element.getAttribute("data-label"),
                renderHTML: (attributes) => {
                    if (!attributes.label) return {};
                    return { "data-label": attributes.label };
                }
            },
            type: {
                default: "file",
                parseHTML: (element) =>
                    element.getAttribute("data-type") ?? "file",
                renderHTML: (attributes) => ({
                    "data-type": attributes.type ?? "file"
                })
            }
        };
    }
});
