export type TodoStatus =
    | "pending"
    | "in_progress"
    | "completed"
    | "cancelled";

export interface Todo {
    id: string;
    conversation_id: string;
    content: string;
    status: TodoStatus;
    sort_index: number;
    created_at: string;
    updated_at: string;
}
