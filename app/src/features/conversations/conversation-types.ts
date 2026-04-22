import type { Attachment } from "@/features/attachments";

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
    message_seq?: number | null;
    /**
     * Raw partial JSON fragment the model has streamed so far for this tool
     * call's input. Populated incrementally by `tool-input-delta` SSE events
     * and cleared once the finalized `tool-call` event arrives (or the call
     * finishes otherwise). Never persisted — only lives on streaming rows.
     */
    partial_input_text?: string;
    /**
     * True while the model is still streaming the tool's input JSON. Flips
     * to false on `tool-input-end` or once the finalized input is known.
     */
    input_streaming?: boolean;
}

export interface ReasoningPart {
    id: string;
    message_id: string;
    text: string;
    started_at: string;
    ended_at: string | null;
    sort_index: number;
    message_seq?: number | null;
}

export interface Message {
    id: string;
    conversation_id: string;
    role: MessageRole;
    content: string;
    created_at: string;
    isStreaming?: boolean;
    tool_invocations?: ToolInvocation[];
    attachments?: Attachment[];
    reasoning_parts?: ReasoningPart[];
    reasoning?: string;
    isReasoning?: boolean;
    reasoning_started_at?: string;
    reasoning_ended_at?: string;
    input_tokens?: number | null;
    output_tokens?: number | null;
    reasoning_tokens?: number | null;
    total_tokens?: number | null;
    compacted?: boolean;
    summary_of_until?: string | null;
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
