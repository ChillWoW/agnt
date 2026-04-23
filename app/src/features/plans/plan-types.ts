export interface PlanTodo {
    id: string;
    content: string;
}

export interface Plan {
    id: string;
    conversationId: string;
    title: string | null;
    content: string;
    todos: PlanTodo[];
    filePath: string;
    createdAt: string;
    updatedAt: string;
}

export type AgenticMode = "agent" | "plan";
