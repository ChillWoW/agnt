import { z } from "zod";
import { logger } from "../../../lib/logger";
import {
    findSkill,
    listSkillFiles,
    type Skill
} from "../../skills/skills.service";
import type { ToolDefinition } from "./types";

export const useSkillInputSchema = z.object({
    name: z
        .string()
        .describe(
            "Exact name of the skill to load (as listed in <available_skills>). Case-insensitive."
        )
});

export type UseSkillInput = z.infer<typeof useSkillInputSchema>;

export interface UseSkillFoundOutput {
    ok: true;
    name: string;
    description: string;
    source: "user" | "project";
    directory: string;
    content: string;
    files: string[];
}

export interface UseSkillErrorOutput {
    ok: false;
    error: string;
    requested: string;
    available: string[];
}

export type UseSkillOutput = UseSkillFoundOutput | UseSkillErrorOutput;

function makeExecuteUseSkill(getSkills: () => Skill[]) {
    return async function executeUseSkill(
        input: UseSkillInput
    ): Promise<UseSkillOutput> {
        const skills = getSkills();
        const skill = findSkill(input.name, skills);

        if (!skill) {
            const available = skills.map((s) => s.name);
            logger.log("[tool:use_skill] skill not found", {
                requested: input.name,
                available
            });
            return {
                ok: false,
                error:
                    available.length > 0
                        ? `Skill "${input.name}" not found. Available skills: ${available.join(", ")}`
                        : `Skill "${input.name}" not found. No skills are registered for this workspace or user.`,
                requested: input.name,
                available
            };
        }

        const files = await listSkillFiles(skill);

        logger.log("[tool:use_skill]", {
            name: skill.name,
            source: skill.source,
            directory: skill.directory,
            fileCount: files.length
        });

        return {
            ok: true,
            name: skill.name,
            description: skill.description,
            source: skill.source,
            directory: skill.directory,
            content: skill.content,
            files
        };
    };
}

function buildDescription(skills: Skill[]): string {
    const base =
        "Load a skill's full playbook into the conversation. " +
        "Call this the moment a task clearly matches one of the available skills. " +
        "Returns the skill's markdown body plus a listing of bundled files you can read next with `read_file`.";

    if (skills.length === 0) {
        return (
            base +
            " (No skills are currently registered for this workspace or user.)"
        );
    }

    const names = skills.map((s) => s.name).join(", ");
    return base + ` Available skills: ${names}.`;
}

export function createUseSkillToolDef(
    getSkills: () => Skill[] = () => []
): ToolDefinition<UseSkillInput, UseSkillOutput> {
    return {
        name: "use_skill",
        description: buildDescription(getSkills()),
        inputSchema: useSkillInputSchema,
        execute: makeExecuteUseSkill(getSkills)
    };
}

export const useSkillToolDef = createUseSkillToolDef();
