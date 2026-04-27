import { z } from "zod";

// ─── Global user rules ────────────────────────────────────────────────────────
//
// A rule is just a body of markdown text. Persisted as one file per rule at
// `~/.agnt/rules/<id>.md`, where `<id>` is a UUID. There is no title, no
// enabled toggle, no per-mode scoping — every rule is global and always-on.
//
// `updatedAt` is the file's `mtime` in ms; the list is returned newest-first.

export interface Rule {
    id: string;
    body: string;
    updatedAt: number;
}

export const ruleBodySchema = z
    .string()
    .max(20000, "Rule body must be 20,000 characters or fewer.");

export const createRuleRequestSchema = z.object({
    body: ruleBodySchema.default("")
});

export const updateRuleRequestSchema = z.object({
    body: ruleBodySchema
});

export type CreateRuleRequest = z.infer<typeof createRuleRequestSchema>;
export type UpdateRuleRequest = z.infer<typeof updateRuleRequestSchema>;
