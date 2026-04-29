import { ChatTeardropDotsIcon } from "@phosphor-icons/react";
import type { ToolInvocation } from "@/features/conversations/conversation-types";
import { ToolBlock } from "./shared/ToolBlock";
import { isRecord } from "./shared/format";

interface QuestionSpecShape {
    question?: string;
    header?: string;
    options?: { label?: string; description?: string }[];
    multiple?: boolean;
}

interface QuestionInputShape {
    questions?: QuestionSpecShape[];
}

interface QuestionOutputShape {
    answers?: string[][];
}

function formatQuestionDetail(
    input: QuestionInputShape | undefined,
    output: QuestionOutputShape | undefined
): string | undefined {
    const count = Array.isArray(input?.questions)
        ? input.questions.length
        : undefined;
    const answered = Array.isArray(output?.answers)
        ? output.answers.length
        : undefined;

    if (typeof count !== "number") return undefined;
    const countLabel = `${count} ${count === 1 ? "question" : "questions"}`;
    if (typeof answered === "number" && answered > 0) {
        return `${countLabel} · answered`;
    }
    return countLabel;
}

export function QuestionBlock({ invocation }: { invocation: ToolInvocation }) {
    const input = isRecord(invocation.input)
        ? (invocation.input as QuestionInputShape)
        : undefined;
    const output = isRecord(invocation.output)
        ? (invocation.output as QuestionOutputShape)
        : undefined;
    const detail = formatQuestionDetail(input, output);

    return (
        <ToolBlock
            icon={<ChatTeardropDotsIcon className="size-3.5" weight="fill" />}
            pendingLabel="Waiting for user input"
            successLabel="User input received"
            errorLabel="Question cancelled"
            deniedLabel="Question cancelled"
            detail={detail}
            error={invocation.error}
            status={invocation.status}
        />
    );
}
