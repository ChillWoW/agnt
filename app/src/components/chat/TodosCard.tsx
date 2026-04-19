import { useEffect, useMemo } from "react";
import {
    CaretDownIcon,
    CheckCircleIcon,
    CircleIcon,
    CircleDashedIcon,
    ListChecksIcon,
    XCircleIcon
} from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { useTodoStore, type Todo, type TodoStatus } from "@/features/todos";

interface TodosCardProps {
    workspaceId: string;
    conversationId: string;
}

function StatusIcon({ status }: { status: TodoStatus }) {
    switch (status) {
        case "completed":
            return (
                <CheckCircleIcon className="size-4 shrink-0 text-dark-200" />
            );
        case "in_progress":
            return (
                <CircleDashedIcon className="size-4 shrink-0 animate-spin text-dark-200" />
            );
        case "cancelled":
            return <XCircleIcon className="size-4 shrink-0 text-dark-200" />;
        case "pending":
        default:
            return <CircleIcon className="size-4 shrink-0 text-dark-200" />;
    }
}

function TodoRow({ todo }: { todo: Todo }) {
    const isCompleted = todo.status === "completed";
    const isCancelled = todo.status === "cancelled";
    const isInProgress = todo.status === "in_progress";

    return (
        <li className="flex items-start gap-2 py-1">
            <div className="mt-0.5">
                <StatusIcon status={todo.status} />
            </div>
            <span
                className={cn(
                    "min-w-0 flex-1 text-sm leading-snug",
                    isCompleted && "text-dark-300 line-through",
                    isCancelled && "text-dark-300 line-through",
                    isInProgress && "text-dark-100 font-medium",
                    !isCompleted &&
                        !isCancelled &&
                        !isInProgress &&
                        "text-dark-200"
                )}
            >
                {todo.content}
            </span>
        </li>
    );
}

export function TodosCard({ workspaceId, conversationId }: TodosCardProps) {
    const todos = useTodoStore((s) => s.todosByConversationId[conversationId]);
    const userCollapsed = useTodoStore(
        (s) => s.collapsedByConversationId[conversationId]
    );
    const toggleCollapsed = useTodoStore((s) => s.toggleCollapsed);
    const setCollapsed = useTodoStore((s) => s.setCollapsed);
    const loadTodos = useTodoStore((s) => s.loadTodos);

    useEffect(() => {
        if (!todos) {
            void loadTodos(workspaceId, conversationId);
        }
    }, [todos, workspaceId, conversationId, loadTodos]);

    const counts = useMemo(() => {
        const c = { total: 0, completed: 0, in_progress: 0 };
        for (const t of todos ?? []) {
            c.total += 1;
            if (t.status === "completed") c.completed += 1;
            if (t.status === "in_progress") c.in_progress += 1;
        }
        return c;
    }, [todos]);

    const allDone = counts.total > 0 && counts.completed === counts.total;
    const collapsed = userCollapsed ?? false;

    if (!todos || todos.length === 0 || allDone) return null;

    const activeTodo = todos.find((t) => t.status === "in_progress");

    return (
        <div className="border-b border-dark-700">
            <button
                type="button"
                onClick={() => {
                    if (userCollapsed === undefined) {
                        setCollapsed(conversationId, !collapsed);
                    } else {
                        toggleCollapsed(conversationId);
                    }
                }}
                className="flex w-full items-center gap-2 px-2.5 py-2 text-left transition-colors hover:bg-dark-850"
            >
                <ListChecksIcon
                    className="size-3.5 shrink-0 text-dark-200"
                    weight="bold"
                />
                <div className="flex min-w-0 flex-1 items-center gap-1.5 text-xs">
                    <span className="text-dark-200">
                        {counts.completed}/{counts.total} complete
                    </span>
                    {activeTodo && (
                        <>
                            <span className="text-dark-400">·</span>
                            <span className="min-w-0 truncate text-dark-100">
                                {activeTodo.content}
                            </span>
                        </>
                    )}
                </div>
                <CaretDownIcon
                    className={cn(
                        "size-3.5 shrink-0 text-dark-300 transition-transform",
                        !collapsed && "rotate-180"
                    )}
                    weight="bold"
                />
            </button>

            <div
                className={cn(
                    "grid transition-[grid-template-rows] duration-300 ease-in-out",
                    collapsed ? "grid-rows-[0fr]" : "grid-rows-[1fr]"
                )}
            >
                <div className="min-h-0 overflow-hidden">
                    <ul className="max-h-60 overflow-y-auto border-t border-dark-700 px-2.5 py-2">
                        {todos.map((todo) => (
                            <TodoRow key={todo.id} todo={todo} />
                        ))}
                    </ul>
                </div>
            </div>
        </div>
    );
}
