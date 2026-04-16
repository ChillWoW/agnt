export type MessageRole = "user" | "assistant" | "system";

export type ToolInvocationStatus = "pending" | "success" | "error";

export interface ToolInvocation {
    id: string;
    message_id: string;
    tool_name: string;
    input: unknown;
    output: unknown;
    error: string | null;
    status: ToolInvocationStatus;
    created_at: string;
}

export interface Message {
    id: string;
    conversation_id: string;
    role: MessageRole;
    content: string;
    created_at: string;
    isStreaming?: boolean;
    tool_invocations?: ToolInvocation[];
    reasoning?: string;
    isReasoning?: boolean;
}

export interface Conversation {
    id: string;
    title: string;
    created_at: string;
    updated_at: string;
}

export interface ConversationWithMessages extends Conversation {
    messages: Message[];
}
