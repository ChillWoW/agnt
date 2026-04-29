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
    /**
     * Live stdout/stderr feed for `shell` / `await_shell` invocations. Chunks
     * are appended as `tool-progress` SSE events arrive and reconstructed
     * from the periodically-persisted `output_json.partial_output` on history
     * hydration.
     */
    shell_stream?: ShellStreamState;
    /**
     * For `task` tool invocations only: the UUID of the spawned subagent
     * conversation. Populated by `subagent-started` SSE events as soon as
     * the hidden child row is created, and also from `output_json.subagentId`
     * on history hydration. Used by TaskBlock to build the
     * `/conversations/<id>` click-through link.
     */
    subagent_id?: string | null;
}

export interface ShellStreamChunk {
    stream: "stdout" | "stderr";
    chunk: string;
    at?: string;
}

export interface ShellStreamState {
    chunks: ShellStreamChunk[];
    task_id?: string;
    state?:
        | "running_foreground"
        | "running_background"
        | "completed"
        | "killed";
    exit_code?: number | null;
    pid?: number | null;
    running_for_ms?: number;
    log_path?: string;
    truncated?: boolean;
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
    model_id?: string | null;
    /**
     * Total wall-clock time the assistant spent actively generating this
     * message, in milliseconds. Excludes periods where the stream was
     * blocked waiting on a permission prompt or question. Populated by the
     * server on `finish` / `abort`. For in-flight messages, the client
     * derives a live counter from `created_at` (see `MessageFooter`).
     */
    generation_duration_ms?: number | null;
    /**
     * UUID linking sibling alternatives within a branch group. NULL on
     * non-branched messages (the common case). Populated when the user
     * regenerates the latest assistant turn or edits the latest user
     * message — both flows fork the latest turn into multiple alternatives
     * the user can switch between via the assistant footer's
     * `< n / m >` navigator.
     */
    branch_group_id?: string | null;
    /** 0-based position within the branch group. */
    branch_index?: number;
}

/**
 * Latest-turn branch summary used by the assistant footer's navigator.
 * Present on a `ConversationWithMessages` whenever the conversation has an
 * active branch group; absent otherwise.
 */
export interface BranchInfo {
    groupId: string;
    activeIndex: number;
    total: number;
}

export type SubagentType =
    | "generalPurpose"
    | "explore"
    | "shell"
    | "docs"
    | "best-of-n-runner";

export interface Conversation {
    id: string;
    title: string;
    created_at: string;
    updated_at: string;
    parent_conversation_id?: string | null;
    subagent_type?: SubagentType | null;
    subagent_name?: string | null;
    hidden?: boolean;
    archived_at?: string | null;
    /**
     * ISO timestamp the user pinned this conversation, or `null`/undefined
     * if it isn't pinned. Pinned rows render in the global "Pinned" group
     * at the top of the sidebar (above all workspace lists) and are
     * excluded from their owning workspace's normal conversation list.
     * Archiving a conversation auto-clears `pinned_at` on the server, so
     * an archived row never appears in the Pinned group.
     */
    pinned_at?: string | null;
    /**
     * Currently-active branch group on this conversation. NULL means no
     * branching is in flight; a UUID means the conversation's latest turn
     * has multiple alternatives, of which `active_branch_index` is the
     * visible one. Cleared when the user sends a new follow-up message
     * (the server seals the active branch into permanent history).
     */
    active_branch_group_id?: string | null;
    active_branch_index?: number;
}

export interface SubagentStartedEvent {
    parent_conversation_id: string;
    messageId: string;
    subagent: {
        id: string;
        parentConversationId: string;
        subagentType: SubagentType;
        subagentName: string;
        title: string;
        startedAt: string;
    };
}

export interface SubagentFinishedEvent {
    parent_conversation_id: string;
    messageId: string;
    subagent_id: string;
    outcome: "success" | "error" | "aborted";
    final_text: string | null;
    error: string | null;
    ended_at: string;
}

export interface ConversationWithMessages extends Conversation {
    messages: Message[];
    /**
     * Branch summary for the conversation's currently-active branch group.
     * Server omits/null-sets this whenever no branching is in flight; the
     * UI uses its presence to render the assistant footer's navigator.
     */
    branch_info?: BranchInfo | null;
}
