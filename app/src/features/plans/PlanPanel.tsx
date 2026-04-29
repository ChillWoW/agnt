import { useCallback, useEffect } from "react";
import {
    CheckCircleIcon,
    CircleIcon,
    RocketLaunchIcon,
    NotepadIcon
} from "@phosphor-icons/react";
import { Button, toast } from "@/components/ui";
import { toApiErrorMessage } from "@/lib/api";
import { MarkdownRenderer } from "@/components/markdown/markdown-renderer";
import { usePlanStore } from "./plan-store";
import { useAgenticMode } from "./use-agentic-mode";
import { buildFromPlan } from "./plan-api";
import { useTodoStore } from "@/features/todos";
import { useConversationStore } from "@/features/conversations";
import { useWorkspaceStore } from "@/features/workspaces";
import type { PlanTodo } from "./plan-types";

export const PLAN_FILE_PREFIX = "__plan__/";

function PlanTodoRow({ todo, index }: { todo: PlanTodo; index: number }) {
    return (
        <li className="flex items-start gap-2 py-1">
            <div className="mt-0.5">
                <CircleIcon className="size-4 shrink-0 text-dark-300" />
            </div>
            <span className="min-w-0 flex-1 text-sm leading-snug text-dark-200">
                {index + 1}. {todo.content}
            </span>
        </li>
    );
}

export function PlanPanel() {
    const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
    const activeConversationId = useConversationStore(
        (s) => s.activeConversationId
    );
    const plan = usePlanStore((s) =>
        activeConversationId
            ? s.plansByConversationId[activeConversationId]
            : undefined
    );
    const loadPlan = usePlanStore((s) => s.loadPlan);
    const setTodos = useTodoStore((s) => s.setTodos);
    const sendMessage = useConversationStore((s) => s.sendMessage);
    const { setAgenticMode } = useAgenticMode({
        workspaceId: activeWorkspaceId,
        conversationId: activeConversationId
    });

    useEffect(() => {
        if (activeWorkspaceId && activeConversationId && !plan) {
            void loadPlan(activeWorkspaceId, activeConversationId);
        }
    }, [activeWorkspaceId, activeConversationId, plan, loadPlan]);

    const handleBuild = useCallback(async () => {
        if (!activeWorkspaceId || !activeConversationId) return;

        try {
            const result = await buildFromPlan(
                activeWorkspaceId,
                activeConversationId
            );

            if (result.todos) {
                setTodos(activeConversationId, result.todos);
            }

            await setAgenticMode("agent");

            toast.success({
                title: "Building from plan",
                description: result.todos
                    ? `${result.todos.length} todo${result.todos.length === 1 ? "" : "s"} queued.`
                    : undefined
            });

            void sendMessage(
                activeWorkspaceId,
                activeConversationId,
                "Build according to the plan. The todos have been set up — start working through them."
            );
        } catch (error) {
            toast.error({
                title: "Couldn't build from plan",
                description: toApiErrorMessage(
                    error,
                    "Failed to build from plan"
                )
            });
        }
    }, [
        activeWorkspaceId,
        activeConversationId,
        setTodos,
        sendMessage,
        setAgenticMode
    ]);

    if (!plan) {
        return (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-dark-300">
                <NotepadIcon className="size-8" />
                <p className="text-center text-xs">
                    No plan yet. Switch to Plan mode and ask the agent to create
                    one.
                </p>
            </div>
        );
    }

    return (
        <div className="flex flex-1 flex-col overflow-hidden">
            <div className="shrink-0 border-b border-dark-700 px-2.5 py-2">
                <h3 className="text-sm font-semibold text-dark-50 truncate">
                    {plan.title ?? "Untitled Plan"}
                </h3>
                <p className="text-[11px] text-dark-200 mt-0.5">
                    Updated{" "}
                    {new Date(plan.updatedAt).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit"
                    })}
                </p>
            </div>

            <div className="flex-1 overflow-y-auto px-3 py-3">
                <div className="prose-sm">
                    <MarkdownRenderer content={plan.content} />
                </div>

                {plan.todos.length > 0 && (
                    <div className="mt-4 border-t border-dark-700 pt-3">
                        <div className="flex items-center gap-1.5 mb-2">
                            <CheckCircleIcon className="size-4 text-dark-300" />
                            <span className="text-xs font-medium text-dark-200">
                                Implementation Steps ({plan.todos.length})
                            </span>
                        </div>
                        <ul className="space-y-0.5">
                            {plan.todos.map((todo, i) => (
                                <PlanTodoRow
                                    key={todo.id}
                                    todo={todo}
                                    index={i}
                                />
                            ))}
                        </ul>
                    </div>
                )}
            </div>

            <div className="shrink-0 border-t border-dark-700">
                <div className="p-2">
                    <Button size="sm" className="w-full" onClick={handleBuild}>
                        <RocketLaunchIcon className="size-4" weight="bold" />
                        Build
                    </Button>
                </div>
            </div>
        </div>
    );
}
