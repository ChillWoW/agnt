import { BookOpenTextIcon } from "@phosphor-icons/react";
import type {
    ToolInvocation,
    ToolInvocationStatus
} from "@/features/conversations/conversation-types";
import { ToolBlock } from "./shared/ToolBlock";
import { isRecord } from "./shared/format";

interface UseSkillInput {
    name?: string;
}

interface UseSkillOutput {
    ok?: boolean;
    name?: string;
    description?: string;
    source?: "user" | "project";
    files?: string[];
    error?: string;
    requested?: string;
    available?: string[];
}

function formatSkillDetail(
    input: UseSkillInput | undefined,
    output: UseSkillOutput | undefined
): string | undefined {
    const name =
        (typeof output?.name === "string" && output.name.length > 0
            ? output.name
            : undefined) ??
        (typeof input?.name === "string" && input.name.length > 0
            ? input.name
            : undefined);

    if (!name) return undefined;

    if (output?.ok === false) {
        return name;
    }

    return name;
}

export function UseSkillBlock({ invocation }: { invocation: ToolInvocation }) {
    const input = isRecord(invocation.input)
        ? (invocation.input as UseSkillInput)
        : undefined;
    const output = isRecord(invocation.output)
        ? (invocation.output as UseSkillOutput)
        : undefined;
    const detail = formatSkillDetail(input, output);
    const notFound = output?.ok === false;

    // Treat a "skill not found" return as an error-shaped result so the block
    // renders in the error style even though execute() didn't throw.
    const status: ToolInvocationStatus = notFound ? "error" : invocation.status;
    const error =
        invocation.error ??
        (notFound ? (output?.error ?? "Skill not found") : null);

    return (
        <ToolBlock
            icon={<BookOpenTextIcon className="size-3.5" weight="bold" />}
            pendingLabel="Loading skill"
            successLabel="Loaded skill"
            errorLabel="Skill failed"
            deniedLabel="Skill denied"
            detail={detail}
            error={error}
            status={status}
        />
    );
}
