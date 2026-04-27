import {
    mkdirSync,
    readdirSync,
    readFileSync,
    statSync,
    unlinkSync,
    writeFileSync
} from "node:fs";
import { join } from "node:path";
import { getHomePath } from "../../lib/homedir";
import { logger } from "../../lib/logger";
import type { Rule } from "./rules.types";

// ─── Global user rules ────────────────────────────────────────────────────────
//
// Rules are global, plain markdown bodies stored one-per-file under
// `~/.agnt/rules/<id>.md`. The filename (minus extension) is a UUID and is
// the rule's stable identifier. There is no index file — the directory IS
// the source of truth.

const RULES_DIR = getHomePath("rules");

const FILE_EXT = ".md";

// UUID v4-ish, but we accept any UUID-shaped id (8-4-4-4-12 hex). We never
// trust user input as a file path; this regex is the only thing that ever
// gets joined onto the rules dir, which closes off path-traversal entirely.
const ID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function ensureRulesDir(): void {
    try {
        mkdirSync(RULES_DIR, { recursive: true });
    } catch {
        // directory already exists
    }
}

function isValidRuleId(id: string): boolean {
    return ID_REGEX.test(id);
}

function rulePath(id: string): string {
    return join(RULES_DIR, `${id}${FILE_EXT}`);
}

function readRuleFile(id: string): Rule | null {
    const filePath = rulePath(id);
    try {
        const body = readFileSync(filePath, "utf8");
        const stat = statSync(filePath);
        return {
            id,
            body,
            updatedAt: stat.mtimeMs
        };
    } catch {
        return null;
    }
}

export function listRules(): Rule[] {
    ensureRulesDir();

    let entries: string[];
    try {
        entries = readdirSync(RULES_DIR);
    } catch (error) {
        logger.error("[rules] failed to read rules dir", error);
        return [];
    }

    const rules: Rule[] = [];
    for (const entry of entries) {
        if (!entry.endsWith(FILE_EXT)) continue;
        const id = entry.slice(0, -FILE_EXT.length);
        if (!isValidRuleId(id)) continue;

        const rule = readRuleFile(id);
        if (rule) rules.push(rule);
    }

    // Newest-first: most recently edited rules float to the top of the UI
    // list, which matches how users mentally rank what they just touched.
    rules.sort((a, b) => b.updatedAt - a.updatedAt);
    return rules;
}

export function getRule(id: string): Rule | null {
    if (!isValidRuleId(id)) return null;
    return readRuleFile(id);
}

export function createRule(body: string): Rule {
    ensureRulesDir();
    const id = crypto.randomUUID();
    writeFileSync(rulePath(id), body, "utf8");

    const stat = statSync(rulePath(id));
    return { id, body, updatedAt: stat.mtimeMs };
}

export class RuleNotFoundError extends Error {
    constructor(id: string) {
        super(`Rule not found: ${id}`);
        this.name = "RuleNotFoundError";
    }
}

export class InvalidRuleIdError extends Error {
    constructor(id: string) {
        super(`Invalid rule id: ${id}`);
        this.name = "InvalidRuleIdError";
    }
}

export function updateRule(id: string, body: string): Rule {
    if (!isValidRuleId(id)) throw new InvalidRuleIdError(id);

    const filePath = rulePath(id);
    try {
        statSync(filePath);
    } catch {
        throw new RuleNotFoundError(id);
    }

    writeFileSync(filePath, body, "utf8");
    const stat = statSync(filePath);
    return { id, body, updatedAt: stat.mtimeMs };
}

export function deleteRule(id: string): void {
    if (!isValidRuleId(id)) throw new InvalidRuleIdError(id);

    try {
        unlinkSync(rulePath(id));
    } catch (error) {
        const code =
            error && typeof error === "object" && "code" in error
                ? (error as { code?: string }).code
                : undefined;
        if (code === "ENOENT") {
            throw new RuleNotFoundError(id);
        }
        throw error;
    }
}

/**
 * Return the ordered list of non-empty rule bodies for prompt injection.
 *
 * Empty / whitespace-only rules are skipped here so the prompt block stays
 * tidy even when the UI has draft cards the user hasn't filled in yet.
 */
export function loadRulesForPrompt(): string[] {
    return listRules()
        .map((rule) => rule.body.trim())
        .filter((body) => body.length > 0);
}
