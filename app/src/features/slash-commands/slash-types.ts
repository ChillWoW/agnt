import type { AgenticMode } from "@/features/plans";
import type { PermissionMode } from "@/features/permissions";

export type SlashCommandKind = "skill" | "mode";

export type SlashSkillSource = "user" | "project";

/**
 * Mode-command effects: switching agentic mode (`/plan`, `/agent`) or
 * permission mode (`/ask`, `/bypass`).
 */
export type SlashModeEffect =
    | { kind: "agentic"; value: AgenticMode }
    | { kind: "permission"; value: PermissionMode };

/**
 * A single slash-command entry rendered in the popover. Built-in mode
 * commands carry a `mode` effect; skill commands carry a `source`.
 */
export interface SlashCommand {
    /**
     * The command identifier (without the leading `/`). Used both as the
     * filter key and as what the editor inserts on selection.
     */
    name: string;
    /** Display label in the popover (usually `name` rendered with a leading `/`). */
    label: string;
    /** One-line description shown next to the label. */
    description: string;
    kind: SlashCommandKind;
    /** Only present on built-in mode commands. */
    mode?: SlashModeEffect;
    /** Only present on skill commands. */
    source?: SlashSkillSource;
}
