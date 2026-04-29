import { ListChecksIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import type { ToolInvocation } from "@/features/conversations/conversation-types";
import { ToolBlock } from "./shared/ToolBlock";
import { isRecord } from "./shared/format";

interface TodoWriteItemShape {
    id?: string;
    content?: string;
    status?: "pending" | "in_progress" | "completed" | "cancelled";
}

interface TodoWriteInputShape {
    todos?: TodoWriteItemShape[];
}

interface TodoWriteOutputShape {
    ok?: boolean;
    todos?: TodoWriteItemShape[];
    counts?: Partial<
        Record<"pending" | "in_progress" | "completed" | "cancelled", number>
    >;
}

const TODO_STATUS_GLYPH: Record<
    NonNullable<TodoWriteItemShape["status"]>,
    string
> = {
    pending: "○",
    in_progress: "◐",
    completed: "●",
    cancelled: "×"
};

function formatTodoDetail(
    output: TodoWriteOutputShape | undefined,
    input: TodoWriteInputShape | undefined
): string | undefined {
    const todos = output?.todos ?? input?.todos;
    if (!Array.isArray(todos)) return undefined;
    const total = todos.length;
    const completed = todos.filter((t) => t?.status === "completed").length;
    return `${completed}/${total}`;
}

export function TodoWriteBlock({
    invocation
}: {
    invocation: ToolInvocation;
}) {
    const input = isRecord(invocation.input)
        ? (invocation.input as TodoWriteInputShape)
        : undefined;
    const output = isRecord(invocation.output)
        ? (invocation.output as TodoWriteOutputShape)
        : undefined;
    const todos = output?.todos ?? input?.todos ?? [];
    const detail = formatTodoDetail(output, input);

    return (
        <ToolBlock
            icon={<ListChecksIcon className="size-3.5" weight="bold" />}
            pendingLabel="Updating todos"
            successLabel="Updated todos"
            errorLabel="Todo update failed"
            detail={detail}
            error={invocation.error}
            status={invocation.status}
        >
            {invocation.error ? (
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-red-200">
                    {invocation.error}
                </p>
            ) : todos.length > 0 ? (
                <ul className="flex flex-col text-[11px] text-dark-200">
                    {todos.map((t, idx) => {
                        const status = t?.status ?? "pending";
                        const isDone =
                            status === "completed" || status === "cancelled";
                        return (
                            <li
                                key={t?.id ?? idx}
                                className="flex items-start gap-1.5"
                            >
                                <span className="shrink-0 text-dark-300">
                                    {TODO_STATUS_GLYPH[status]}
                                </span>
                                <span
                                    className={cn(
                                        "min-w-0",
                                        isDone && "text-dark-300 line-through"
                                    )}
                                >
                                    {t?.content ?? ""}
                                </span>
                            </li>
                        );
                    })}
                </ul>
            ) : null}
        </ToolBlock>
    );
}
