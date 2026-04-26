import { readdirSync, readFileSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import { logger } from "../../lib/logger";
import { getHomeDir } from "../../lib/homedir";
import { getWorkspace } from "../workspaces/workspaces.service";

export type SkillSource = "user" | "project";

export interface Skill {
    name: string;
    description: string;
    content: string;
    directory: string;
    source: SkillSource;
}

export interface DiscoveredSkills {
    workspaceId: string;
    workspacePath: string;
    userSkillsDirs: string[];
    projectSkillsDirs: string[];
    skills: Skill[];
    warnings: string[];
}

const SKILL_FILENAME = "SKILL.md";

/**
 * User-side skill roots (relative to the OS home directory). `.agnt/skills`
 * is our app's own convention; the rest mirror other agent tools so users can
 * share skills across Cursor/Claude/etc. Later entries override earlier ones
 * on name collisions.
 */
const USER_SKILL_DIRS = [
    ".agnt/skills",
    ".agents/skills",
    ".claude/skills"
] as const;

/**
 * Project-side skill roots scanned inside the active workspace. Later entries
 * override earlier ones on name collisions, and project skills always win
 * over user skills with the same name.
 */
const PROJECT_SKILL_DIRS = [
    ".agnt/skills",
    ".agents/skills",
    ".claude/skills"
] as const;

function parseFrontmatter(raw: string): {
    data: Record<string, string>;
    body: string;
} {
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!match) {
        return { data: {}, body: raw.trim() };
    }

    const data: Record<string, string> = {};
    const frontmatterBlock = match[1] ?? "";
    const bodyBlock = match[2] ?? "";

    for (const rawLine of frontmatterBlock.split("\n")) {
        const line = rawLine.replace(/\r$/, "");
        const idx = line.indexOf(":");
        if (idx <= 0) continue;

        const key = line.slice(0, idx).trim();
        let value = line.slice(idx + 1).trim();
        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }

        if (key && value) {
            data[key] = value;
        }
    }

    return { data, body: bodyBlock.trim() };
}

function safeReadFile(path: string): string | null {
    try {
        return readFileSync(path, "utf8");
    } catch {
        return null;
    }
}

function safeReaddirSync(dir: string): string[] {
    try {
        return readdirSync(dir);
    } catch {
        return [];
    }
}

function collectSkillsFromDir(
    dir: string,
    source: SkillSource,
    warnings: string[]
): Skill[] {
    const entries = safeReaddirSync(dir);
    if (entries.length === 0) return [];

    const skills: Skill[] = [];

    for (const entry of entries) {
        const skillDir = join(dir, entry);

        let stats;
        try {
            stats = statSync(skillDir);
        } catch {
            continue;
        }

        if (!stats.isDirectory()) continue;

        const skillFile = join(skillDir, SKILL_FILENAME);
        const raw = safeReadFile(skillFile);
        if (raw === null) continue;

        const { data, body } = parseFrontmatter(raw);
        const name = data.name?.trim() || entry;
        const description = data.description?.trim() ?? "";

        if (!description) {
            warnings.push(
                `Skill "${name}" at ${skillFile} has no description in its frontmatter; it will still be loadable but agents won't see a summary.`
            );
        }

        skills.push({
            name,
            description,
            content: body,
            directory: skillDir,
            source
        });
    }

    return skills;
}

function dedupByName(
    groups: Skill[][]
): { skills: Skill[]; overriddenNames: string[] } {
    const map = new Map<string, Skill>();
    const overriddenNames: string[] = [];

    for (const group of groups) {
        for (const skill of group) {
            const key = skill.name.toLowerCase();
            if (map.has(key)) {
                overriddenNames.push(skill.name);
            }
            map.set(key, skill);
        }
    }

    return {
        skills: Array.from(map.values()).sort((a, b) =>
            a.name.localeCompare(b.name)
        ),
        overriddenNames
    };
}

function resolveUserSkillsDirs(): string[] {
    const home = homedir();
    if (!home) return [];
    const dirs: string[] = [];
    // Our app-home skills dir first (may equal ~/.agnt/skills on most setups).
    try {
        dirs.push(join(getHomeDir(), "skills"));
    } catch {
        // getHomeDir throws if HOME is unresolvable; skip.
    }
    for (const rel of USER_SKILL_DIRS) {
        const dir = join(home, rel);
        if (!dirs.includes(dir)) {
            dirs.push(dir);
        }
    }
    return dirs;
}

export function discoverSkillsForPath(
    workspacePath: string,
    workspaceId = ""
): DiscoveredSkills {
    const warnings: string[] = [];
    const userSkillsDirs = resolveUserSkillsDirs();
    const projectSkillsDirs = workspacePath
        ? PROJECT_SKILL_DIRS.map((rel) => join(workspacePath, rel))
        : [];

    const userSkillGroups = userSkillsDirs.map((dir) =>
        collectSkillsFromDir(dir, "user", warnings)
    );

    const projectSkillGroups = projectSkillsDirs.map((dir) =>
        collectSkillsFromDir(dir, "project", warnings)
    );

    // Later groups win: project skills override user skills on name collision,
    // and within each side later dirs override earlier dirs.
    const { skills, overriddenNames } = dedupByName([
        ...userSkillGroups,
        ...projectSkillGroups
    ]);

    if (overriddenNames.length > 0) {
        logger.log(
            "[skills] skill(s) overridden by later discovery root:",
            overriddenNames
        );
    }

    logger.log("[skills] discovery", {
        workspacePath,
        userSkillsDirs,
        projectSkillsDirs,
        found: skills.length,
        names: skills.map((s) => s.name)
    });

    return {
        workspaceId,
        workspacePath,
        userSkillsDirs,
        projectSkillsDirs,
        skills,
        warnings
    };
}

export function discoverSkills(workspaceId: string): DiscoveredSkills {
    try {
        const workspace = getWorkspace(workspaceId);
        return discoverSkillsForPath(workspace.path, workspaceId);
    } catch {
        return discoverSkillsForPath("", workspaceId);
    }
}

function escapeXmlAttribute(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function escapeXmlText(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

/**
 * Build a turn-only system block containing the FULL `SKILL.md` body for each
 * skill the user explicitly requested for this turn (via a leading slash
 * command in the chat input, e.g. `/find-skills`). The frontend strips that
 * leading token and forwards the names as `useSkillNames`; the stream layer
 * resolves them against the workspace's discovered skills and feeds the
 * matched bodies into this block.
 *
 * IMPORTANT: This block is appended as a trailing `role: "system"` message
 * to the per-turn `modelMessages` — NOT folded into the cached `instructions`
 * field — so the conversation's prompt cache prefix (system prompt + repo
 * instructions + skills catalog + chat history) stays bit-identical from one
 * turn to the next. See `conversation.stream.ts` for the full caching note.
 *
 * Returns `""` for an empty input list so callers can cheaply skip the
 * trailing-system-message append.
 */
export function buildActiveSkillsBlock(skills: Skill[]): string {
    if (skills.length === 0) return "";

    const blocks = skills
        .map((skill) => {
            const name = escapeXmlAttribute(skill.name);
            const source = escapeXmlAttribute(skill.source);
            const body = escapeXmlText(skill.content);
            return `<skill name="${name}" source="${source}">\n${body}\n</skill>`;
        })
        .join("\n\n");

    return (
        `## Active Skills\n` +
        `The user explicitly requested the playbooks below for this turn ` +
        `(via a leading \`/<skill-name>\` slash command in the chat input). ` +
        `Apply each playbook as if you had loaded it via \`use_skill\` ` +
        `yourself — follow its instructions for the rest of this turn.\n\n` +
        `<active_skills>\n${blocks}\n</active_skills>`
    );
}

/**
 * Build the block that lists every available skill's name + description for
 * the system prompt. The agent reads this to decide when to call `use_skill`.
 */
export function buildAvailableSkillsBlock(skills: Skill[]): string {
    if (skills.length === 0) return "";

    const entries = skills
        .map((skill) => {
            const name = escapeXmlAttribute(skill.name);
            const description = escapeXmlAttribute(skill.description);
            return `  <skill name="${name}" description="${description}" source="${skill.source}" />`;
        })
        .join("\n");

    return (
        `\n\n## Available Skills\n` +
        `The following skills are bundled with this workspace or the current user. ` +
        `A skill is a reusable playbook of instructions + files kept on disk. ` +
        `When a task clearly matches a skill, call the \`use_skill\` tool with the skill name to load the full playbook before continuing. ` +
        `Never fabricate skill contents. Do not mention skills to the user unless asked.\n\n` +
        `<available_skills>\n${entries}\n</available_skills>`
    );
}

export function findSkill(name: string, skills: Skill[]): Skill | null {
    const target = name.trim().toLowerCase();
    if (!target) return null;
    return skills.find((s) => s.name.toLowerCase() === target) ?? null;
}

async function walkDir(dir: string): Promise<string[]> {
    const results: string[] = [];

    let entries;
    try {
        entries = await readdir(dir, { withFileTypes: true });
    } catch {
        return results;
    }

    for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...(await walkDir(fullPath)));
        } else if (entry.isFile()) {
            results.push(fullPath);
        }
    }

    return results;
}

/**
 * List every file bundled under a skill directory, excluding the SKILL.md
 * playbook itself. Paths are returned relative to the skill directory and
 * normalized to forward slashes for cross-platform stability.
 */
export async function listSkillFiles(skill: Skill): Promise<string[]> {
    const allFiles = await walkDir(skill.directory);

    return allFiles
        .map((file) => relative(skill.directory, file).replace(/\\/g, "/"))
        .filter((file) => file.toUpperCase() !== SKILL_FILENAME)
        .sort();
}
