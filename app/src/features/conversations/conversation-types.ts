export type MessageRole = "user" | "assistant" | "system";

export interface Message {
    id: string;
    conversation_id: string;
    role: MessageRole;
    content: string;
    created_at: string;
    isStreaming?: boolean;
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
