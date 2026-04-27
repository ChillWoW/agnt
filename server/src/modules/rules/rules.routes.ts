import { Elysia } from "elysia";
import {
    createRule,
    deleteRule,
    getRule,
    InvalidRuleIdError,
    listRules,
    RuleNotFoundError,
    updateRule
} from "./rules.service";
import {
    createRuleRequestSchema,
    updateRuleRequestSchema
} from "./rules.types";

// ─── Global user rules HTTP routes ───────────────────────────────────────────
//
// All routes are global (no workspace param). A rule is just a body of text
// that gets appended to the system prompt of every conversation, so there's
// no per-workspace surface to expose.

const rulesRoutes = new Elysia({ prefix: "/rules" })
    .get("/", () => {
        return listRules();
    })
    .get("/:id", ({ params, set }) => {
        const rule = getRule(params.id);
        if (!rule) {
            set.status = 404;
            return { error: `Rule not found: ${params.id}` };
        }
        return rule;
    })
    .post("/", ({ body, set }) => {
        const parsed = createRuleRequestSchema.safeParse(body ?? {});
        if (!parsed.success) {
            set.status = 400;
            return {
                error: "Invalid rule payload.",
                issues: parsed.error.issues
            };
        }

        return createRule(parsed.data.body);
    })
    .put("/:id", ({ params, body, set }) => {
        const parsed = updateRuleRequestSchema.safeParse(body);
        if (!parsed.success) {
            set.status = 400;
            return {
                error: "Invalid rule payload.",
                issues: parsed.error.issues
            };
        }

        try {
            return updateRule(params.id, parsed.data.body);
        } catch (error) {
            if (error instanceof RuleNotFoundError) {
                set.status = 404;
                return { error: error.message };
            }
            if (error instanceof InvalidRuleIdError) {
                set.status = 400;
                return { error: error.message };
            }
            throw error;
        }
    })
    .delete("/:id", ({ params, set }) => {
        try {
            deleteRule(params.id);
            return { ok: true };
        } catch (error) {
            if (error instanceof RuleNotFoundError) {
                set.status = 404;
                return { error: error.message };
            }
            if (error instanceof InvalidRuleIdError) {
                set.status = 400;
                return { error: error.message };
            }
            throw error;
        }
    });

export default rulesRoutes;
