import { create } from "zustand";
import type {
    Conversation,
    ConversationWithMessages,
    Message,
    ReasoningPart,
    SubagentFinishedEvent,
    SubagentStartedEvent,
    ToolInvocation,
    ToolInvocationStatus
} from "./conversation-types";
import * as conversationApi from "./conversation-api";
import { usePermissionStore } from "@/features/permissions";
import type { PermissionRequest } from "@/features/permissions";
import { useQuestionStore } from "@/features/questions";
import type { QuestionSpec, QuestionsRequest } from "@/features/questions";
import { useTodoStore } from "@/features/todos";
import type { Todo } from "@/features/todos";
import { usePlanStore, PLAN_FILE_PREFIX } from "@/features/plans";
import type { Plan } from "@/features/plans";
import { useRightSidebarStore } from "@/features/right-sidebar/right-sidebar-store";
import { useOpenedFilesStore } from "@/features/right-sidebar/filetree";
import type { Attachment } from "@/features/attachments";
import { notify } from "@/features/notifications/notify";
import { isWindowFocused } from "@/features/notifications/focus";
import type {
    CompactedSseEvent,
    ContextSummary,
    UsageSseEvent
} from "@/features/context/context-types";

interface ConversationStoreState {
    conversationsByWorkspace: Record<string, Conversation[]>;
    archivedByWorkspace: Record<string, Conversation[]>;
    conversationsById: Record<string, ConversationWithMessages>;
    activeConversationId: string | null;
    isLoadingList: boolean;
    loadingConversationIds: Record<string, true>;
    streamControllersById: Record<string, AbortController>;
    observerControllersById: Record<string, AbortController>;
    unreadConversationIds: Record<string, true>;
    contextByConversationId: Record<string, ContextSummary>;
    contextRefreshTokens: Record<string, number>;
    subagentsByParentId: Record<string, Conversation[]>;
    /**
     * Per-conversation flag set to true while the server is running
     * auto-compaction (between `compaction-started` and one of `compacted`,
     * `compaction-skipped`, or `compaction-error`). The chat surface uses
     * this to render a transient "Summarizing chat context…" indicator so
     * the user has feedback during the 5–10s LLM call.
     */
    compactingByConversationId: Record<string, true>;

    setActiveConversation: (conversationId: string | null) => void;
    markConversationRead: (conversationId: string) => void;
    stopGeneration: (conversationId?: string) => void;
    setContextSummary: (
        conversationId: string,
        summary: ContextSummary
    ) => void;
    bumpContextRefresh: (conversationId: string) => void;
    setCompacting: (conversationId: string, compacting: boolean) => void;

    loadConversations: (workspaceId: string) => Promise<void>;
    loadArchivedConversations: (workspaceId: string) => Promise<void>;
    loadConversation: (workspaceId: string, conversationId: string) => Promise<void>;
    loadSubagents: (workspaceId: string, parentConversationId: string) => Promise<void>;
    observeConversation: (
        workspaceId: string,
        conversationId: string
    ) => () => void;
    createConversation: (
        workspaceId: string,
        message: string,
        attachmentIds?: string[],
        mentions?: conversationApi.MessageMention[]
    ) => Promise<ConversationWithMessages>;
    sendMessage: (
        workspaceId: string,
        conversationId: string,
        content: string,
        attachmentIds?: string[],
        mentions?: conversationApi.MessageMention[]
    ) => Promise<void>;
    replyToConversation: (workspaceId: string, conversationId: string) => Promise<void>;
    archiveConversation: (workspaceId: string, conversationId: string) => Promise<void>;
    unarchiveConversation: (workspaceId: string, conversationId: string) => Promise<void>;
    deleteConversation: (workspaceId: string, conversationId: string) => Promise<void>;
    clearActiveConversation: () => void;
}

type SseEventPayload = Record<string, unknown>;
type StreamOutcome = "finished" | "aborted" | "errored";

function isAbortError(error: unknown): boolean {
    return error instanceof DOMException && error.name === "AbortError";
}

function omitKey<V>(
    record: Record<string, V>,
    key: string
): Record<string, V> {
    if (!(key in record)) return record;
    const { [key]: _removed, ...rest } = record;
    return rest;
}

function isAssistantMessageEmpty(message: Message): boolean {
    if (message.role !== "assistant") return false;
    if (message.content.length > 0) return false;
    if ((message.tool_invocations?.length ?? 0) > 0) return false;
    if ((message.reasoning?.length ?? 0) > 0) return false;
    if (
        (message.reasoning_parts?.some((part) => part.text.length > 0) ??
            false)
    ) {
        return false;
    }
    return true;
}

function closeOpenReasoningParts(
    parts: ReasoningPart[] | undefined,
    endedAt: string
): ReasoningPart[] | undefined {
    if (!parts || parts.length === 0) return parts;
    let mutated = false;
    const next = parts.map((part) => {
        if (part.ended_at) return part;
        mutated = true;
        return { ...part, ended_at: endedAt };
    });
    return mutated ? next : parts;
}

function finalizeStreamingMessages(messages: Message[]): Message[] {
    return messages.flatMap((message) => {
        if (!message.isStreaming) {
            return [message];
        }

        if (isAssistantMessageEmpty(message)) {
            return [];
        }

        const nowIso = new Date().toISOString();
        return [
            {
                ...message,
                isStreaming: false,
                isReasoning: false,
                reasoning_parts: closeOpenReasoningParts(
                    message.reasoning_parts,
                    nowIso
                )
            }
        ];
    });
}

async function consumeSseStream(
    response: Response,
    onEvent: (event: string, data: SseEventPayload) => void
): Promise<void> {
    if (!response.body) return;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            const parts = buffer.split("\n\n");
            buffer = parts.pop() ?? "";

            for (const chunk of parts) {
                const lines = chunk.split("\n");
                let event = "message";
                let dataLine = "";

                for (const line of lines) {
                    if (line.startsWith("event: ")) {
                        event = line.slice(7).trim();
                    } else if (line.startsWith("data: ")) {
                        dataLine = line.slice(6).trim();
                    }
                }

                if (dataLine) {
                    try {
                        const data = JSON.parse(dataLine) as SseEventPayload;
                        onEvent(event, data);
                    } catch {
                        // Malformed JSON — skip
                    }
                }
            }
        }
    } finally {
        reader.releaseLock();
    }
}

interface SseHandlerCallbacks {
    updateConversation: (
        updater: (prev: ConversationWithMessages) => ConversationWithMessages
    ) => void;
    onCompacted: (event: CompactedSseEvent) => void;
    onUsage: () => void;
    onConversationTitle: (title: string, updatedAt: string | null) => void;
    onSubagentStarted: (event: SubagentStartedEvent) => void;
    onSubagentFinished: (event: SubagentFinishedEvent) => void;
    setOutcome: (outcome: StreamOutcome) => void;
}

function handleConversationSseEvent(
    conversationId: string,
    event: string,
    data: SseEventPayload,
    callbacks: SseHandlerCallbacks
): void {
    const {
        updateConversation,
        onCompacted,
        onUsage,
        onConversationTitle,
        onSubagentStarted,
        onSubagentFinished,
        setOutcome
    } = callbacks;

    switch (event) {
            case "user-message": {
                const attachments = Array.isArray(data.attachments)
                    ? (data.attachments as Attachment[])
                    : undefined;
                const msg: Message = {
                    id: data.id as string,
                    conversation_id: data.conversation_id as string,
                    role: "user",
                    content: data.content as string,
                    created_at: data.created_at as string,
                    ...(attachments && attachments.length > 0
                        ? { attachments }
                        : {})
                };
                updateConversation((prev) => {
                    const exists = prev.messages.some((m) => m.id === msg.id);
                    if (exists) {
                        return {
                            ...prev,
                            messages: prev.messages.map((m) =>
                                m.id === msg.id
                                    ? {
                                          ...m,
                                          ...(attachments && attachments.length > 0
                                              ? { attachments }
                                              : {})
                                      }
                                    : m
                            )
                        };
                    }
                    return { ...prev, messages: [...prev.messages, msg] };
                });
                break;
            }

            case "assistant-start": {
                const msg: Message = {
                    id: data.id as string,
                    conversation_id: data.conversation_id as string,
                    role: "assistant",
                    content: "",
                    created_at: data.created_at as string,
                    isStreaming: true
                };
                updateConversation((prev) => ({
                    ...prev,
                    messages: [...prev.messages, msg]
                }));
                break;
            }

            case "assistant-model": {
                const messageId = data.messageId as string;
                const modelId = (data.modelId as string | undefined) ?? null;
                updateConversation((prev) => ({
                    ...prev,
                    messages: prev.messages.map((m) =>
                        m.id === messageId ? { ...m, model_id: modelId } : m
                    )
                }));
                break;
            }

            case "delta": {
                const delta = data.content as string;
                updateConversation((prev) => {
                    const messages = prev.messages.map((m) => {
                        if (m.role === "assistant" && m.isStreaming) {
                            return { ...m, content: m.content + delta };
                        }
                        return m;
                    });
                    return { ...prev, messages };
                });
                break;
            }

            case "reasoning-start": {
                const messageId = data.messageId as string;
                const partId = data.partId as string;
                const startedAt =
                    (data.startedAt as string | undefined) ??
                    new Date().toISOString();
                const sortIndex =
                    typeof data.sortIndex === "number"
                        ? (data.sortIndex as number)
                        : undefined;
                const messageSeq =
                    typeof data.messageSeq === "number"
                        ? (data.messageSeq as number)
                        : null;
                updateConversation((prev) => ({
                    ...prev,
                    messages: prev.messages.map((m) => {
                        if (m.id !== messageId) return m;
                        const existing = m.reasoning_parts ?? [];
                        if (existing.some((part) => part.id === partId)) {
                            return { ...m, isReasoning: true };
                        }
                        const newPart: ReasoningPart = {
                            id: partId,
                            message_id: messageId,
                            text: "",
                            started_at: startedAt,
                            ended_at: null,
                            sort_index: sortIndex ?? existing.length,
                            message_seq: messageSeq
                        };
                        return {
                            ...m,
                            isReasoning: true,
                            reasoning_parts: [...existing, newPart],
                            reasoning_started_at:
                                m.reasoning_started_at ?? startedAt,
                            reasoning_ended_at: undefined
                        };
                    })
                }));
                break;
            }

            case "reasoning-delta": {
                const messageId = data.messageId as string;
                const partId = data.partId as string | undefined;
                const text = data.text as string;
                updateConversation((prev) => ({
                    ...prev,
                    messages: prev.messages.map((m) => {
                        if (m.id !== messageId) return m;
                        const existing = m.reasoning_parts ?? [];
                        let targetIndex = partId
                            ? existing.findIndex((part) => part.id === partId)
                            : -1;
                        let parts = existing;
                        if (targetIndex === -1) {
                            const nowIso = new Date().toISOString();
                            const fallback: ReasoningPart = {
                                id: partId ?? `local-${crypto.randomUUID()}`,
                                message_id: messageId,
                                text: "",
                                started_at: nowIso,
                                ended_at: null,
                                sort_index: existing.length
                            };
                            parts = [...existing, fallback];
                            targetIndex = parts.length - 1;
                        }
                        const nextParts = parts.map((part, idx) =>
                            idx === targetIndex
                                ? { ...part, text: part.text + text }
                                : part
                        );
                        return {
                            ...m,
                            reasoning_parts: nextParts,
                            reasoning: (m.reasoning ?? "") + text,
                            isReasoning: true
                        };
                    })
                }));
                break;
            }

            case "reasoning-end": {
                const messageId = data.messageId as string;
                const partId = data.partId as string | undefined;
                const endedAt =
                    (data.endedAt as string | undefined) ??
                    new Date().toISOString();
                updateConversation((prev) => ({
                    ...prev,
                    messages: prev.messages.map((m) => {
                        if (m.id !== messageId) return m;
                        const existing = m.reasoning_parts ?? [];
                        const nextParts = existing.map((part) => {
                            if (partId && part.id !== partId) return part;
                            if (!partId && part.ended_at) return part;
                            return { ...part, ended_at: endedAt };
                        });
                        return {
                            ...m,
                            reasoning_parts: nextParts,
                            isReasoning: false,
                            reasoning_ended_at: endedAt
                        };
                    })
                }));
                break;
            }

            case "tool-input-start": {
                const invocation: ToolInvocation = {
                    id: data.id as string,
                    message_id: data.messageId as string,
                    tool_name: data.toolName as string,
                    input: null,
                    output: null,
                    error: null,
                    status: (data.status as ToolInvocationStatus) ?? "pending",
                    created_at:
                        (data.createdAt as string) ??
                        new Date().toISOString(),
                    message_seq:
                        typeof data.messageSeq === "number"
                            ? (data.messageSeq as number)
                            : null,
                    partial_input_text: "",
                    input_streaming: true
                };
                updateConversation((prev) => ({
                    ...prev,
                    messages: prev.messages.map((m) => {
                        if (m.id !== invocation.message_id) return m;
                        const existing = m.tool_invocations ?? [];
                        if (existing.some((inv) => inv.id === invocation.id)) {
                            return m;
                        }
                        return {
                            ...m,
                            tool_invocations: [...existing, invocation]
                        };
                    })
                }));
                break;
            }

            case "tool-input-delta": {
                const messageId = data.messageId as string;
                const invocationId = data.id as string | undefined;
                const toolCallId = data.toolCallId as string | undefined;
                const delta = data.delta as string;
                updateConversation((prev) => ({
                    ...prev,
                    messages: prev.messages.map((m) => {
                        if (m.id !== messageId) return m;
                        const existing = m.tool_invocations ?? [];
                        let matched = false;
                        const tool_invocations = existing.map((inv) => {
                            if (matched) return inv;
                            const hit =
                                (invocationId && inv.id === invocationId) ||
                                (!invocationId &&
                                    toolCallId &&
                                    inv.id === toolCallId);
                            if (!hit) return inv;
                            matched = true;
                            return {
                                ...inv,
                                partial_input_text:
                                    (inv.partial_input_text ?? "") + delta,
                                input_streaming: true
                            };
                        });
                        return matched
                            ? { ...m, tool_invocations }
                            : m;
                    })
                }));
                break;
            }

            case "tool-input-end": {
                const messageId = data.messageId as string;
                const invocationId = data.id as string | undefined;
                updateConversation((prev) => ({
                    ...prev,
                    messages: prev.messages.map((m) => {
                        if (m.id !== messageId) return m;
                        const existing = m.tool_invocations ?? [];
                        let mutated = false;
                        const tool_invocations = existing.map((inv) => {
                            if (invocationId && inv.id !== invocationId) {
                                return inv;
                            }
                            if (!inv.input_streaming) return inv;
                            mutated = true;
                            return { ...inv, input_streaming: false };
                        });
                        return mutated
                            ? { ...m, tool_invocations }
                            : m;
                    })
                }));
                break;
            }

            case "tool-call": {
                const invocation: ToolInvocation = {
                    id: data.id as string,
                    message_id: data.messageId as string,
                    tool_name: data.toolName as string,
                    input: data.input,
                    output: null,
                    error: null,
                    status: (data.status as ToolInvocationStatus) ?? "pending",
                    created_at:
                        (data.createdAt as string) ??
                        new Date().toISOString(),
                    message_seq:
                        typeof data.messageSeq === "number"
                            ? (data.messageSeq as number)
                            : null
                };
                updateConversation((prev) => ({
                    ...prev,
                    messages: prev.messages.map((m) => {
                        if (m.id !== invocation.message_id) return m;
                        const existing = m.tool_invocations ?? [];
                        const existingIdx = existing.findIndex(
                            (inv) => inv.id === invocation.id
                        );
                        if (existingIdx === -1) {
                            return {
                                ...m,
                                tool_invocations: [...existing, invocation]
                            };
                        }
                        const tool_invocations = existing.map((inv, idx) =>
                            idx === existingIdx
                                ? {
                                      ...inv,
                                      tool_name: invocation.tool_name,
                                      input: invocation.input,
                                      status: invocation.status,
                                      created_at: invocation.created_at,
                                      message_seq: invocation.message_seq,
                                      input_streaming: false,
                                      partial_input_text: undefined
                                  }
                                : inv
                        );
                        return { ...m, tool_invocations };
                    })
                }));
                break;
            }

            case "tool-progress": {
                const messageId = data.messageId as string;
                const invocationId = data.id as string;
                const stream = (data.stream as "stdout" | "stderr") ?? "stdout";
                const chunk = (data.chunk as string) ?? "";
                const taskId = data.task_id as string | undefined;
                const at = data.at as string | undefined;
                if (chunk.length === 0) break;
                updateConversation((prev) => ({
                    ...prev,
                    messages: prev.messages.map((m) => {
                        if (m.id !== messageId) return m;
                        const existing = m.tool_invocations ?? [];
                        let mutated = false;
                        const tool_invocations = existing.map((inv) => {
                            if (inv.id !== invocationId) return inv;
                            mutated = true;
                            const prevStream = inv.shell_stream ?? {
                                chunks: []
                            };
                            return {
                                ...inv,
                                shell_stream: {
                                    ...prevStream,
                                    task_id:
                                        prevStream.task_id ??
                                        taskId ??
                                        undefined,
                                    chunks: [
                                        ...prevStream.chunks,
                                        { stream, chunk, at }
                                    ]
                                }
                            };
                        });
                        return mutated ? { ...m, tool_invocations } : m;
                    })
                }));
                break;
            }

            case "tool-lifecycle": {
                const messageId = data.messageId as string;
                const invocationId = data.id as string;
                const state = data.state as
                    | "running_foreground"
                    | "running_background"
                    | "completed"
                    | "killed"
                    | undefined;
                const exitCode = (data.exit_code ?? null) as number | null;
                const taskId = data.task_id as string | undefined;
                updateConversation((prev) => ({
                    ...prev,
                    messages: prev.messages.map((m) => {
                        if (m.id !== messageId) return m;
                        const existing = m.tool_invocations ?? [];
                        let mutated = false;
                        const tool_invocations = existing.map((inv) => {
                            if (inv.id !== invocationId) return inv;
                            mutated = true;
                            const prevStream = inv.shell_stream ?? {
                                chunks: []
                            };
                            return {
                                ...inv,
                                shell_stream: {
                                    ...prevStream,
                                    state,
                                    exit_code: exitCode,
                                    task_id: prevStream.task_id ?? taskId
                                }
                            };
                        });
                        return mutated ? { ...m, tool_invocations } : m;
                    })
                }));
                break;
            }

            case "tool-result": {
                const messageId = data.messageId as string;
                const toolName = data.toolName as string;
                const output = data.output;
                const error = (data.error as string | null) ?? null;
                const status =
                    (data.status as ToolInvocationStatus) ??
                    (error ? "error" : "success");
                // For task invocations the output payload carries the
                // spawned subagent's id — hydrate it onto the invocation
                // so TaskBlock can render a deep-link without relying on
                // the transient subagent-started event (which may have
                // been emitted before the history was hydrated).
                const maybeSubagentId =
                    toolName === "task" &&
                    output &&
                    typeof output === "object" &&
                    "subagentId" in (output as Record<string, unknown>)
                        ? ((output as Record<string, unknown>).subagentId as
                              | string
                              | undefined)
                        : undefined;
                updateConversation((prev) => ({
                    ...prev,
                    messages: prev.messages.map((m) => {
                        if (m.id !== messageId) return m;
                        const existing = m.tool_invocations ?? [];
                        let applied = false;
                        const tool_invocations = existing.map((inv) => {
                            if (
                                applied ||
                                inv.status !== "pending" ||
                                inv.tool_name !== toolName
                            ) {
                                return inv;
                            }
                            applied = true;
                            return {
                                ...inv,
                                status,
                                output,
                                error,
                                ...(maybeSubagentId
                                    ? { subagent_id: maybeSubagentId }
                                    : {})
                            };
                        });
                        return { ...m, tool_invocations };
                    })
                }));
                break;
            }

            case "permission-required": {
                const request: PermissionRequest = {
                    id: data.id as string,
                    conversationId,
                    messageId: data.messageId as string,
                    toolName: data.toolName as string,
                    input: data.input,
                    createdAt:
                        (data.createdAt as string) ??
                        new Date().toISOString()
                };
                usePermissionStore
                    .getState()
                    .setPending(conversationId, request);
                notify({
                    kind: "permission",
                    title: "Permission required",
                    body: `A tool is requesting permission to run`,
                    conversationId
                });
                break;
            }

            case "permission-resolved": {
                const requestId = data.id as string | undefined;
                if (requestId) {
                    usePermissionStore
                        .getState()
                        .clearPendingById(conversationId, requestId);
                } else {
                    usePermissionStore.getState().clearPending(conversationId);
                }
                break;
            }

            case "questions-required": {
                const request: QuestionsRequest = {
                    id: data.id as string,
                    conversationId,
                    messageId: data.messageId as string,
                    questions: (data.questions ?? []) as QuestionSpec[],
                    createdAt:
                        (data.createdAt as string) ??
                        new Date().toISOString()
                };
                useQuestionStore
                    .getState()
                    .setPending(conversationId, request);
                const firstQuestion = request.questions[0]?.question ?? "";
                notify({
                    kind: "question",
                    title: "Agent asked a question",
                    body: firstQuestion.slice(0, 120),
                    conversationId
                });
                break;
            }

            case "todos-updated": {
                const todos = Array.isArray(data.todos)
                    ? (data.todos as Todo[])
                    : [];
                useTodoStore.getState().setTodos(conversationId, todos);
                break;
            }

            case "plan-updated": {
                const planData = data.plan as {
                    id: string;
                    title: string | null;
                    content: string;
                    todos: { id: string; content: string }[];
                    filePath: string;
                    createdAt: string;
                    updatedAt: string;
                } | undefined;
                if (planData) {
                    const plan: Plan = {
                        id: planData.id,
                        conversationId,
                        title: planData.title,
                        content: planData.content,
                        todos: planData.todos,
                        filePath: planData.filePath,
                        createdAt: planData.createdAt,
                        updatedAt: planData.updatedAt
                    };
                    usePlanStore.getState().setPlan(conversationId, plan);
                    useRightSidebarStore.getState().setCollapsed(false);
                    const planPath = `${PLAN_FILE_PREFIX}${conversationId}`;
                    const planName = planData.title ?? "Plan";
                    useOpenedFilesStore
                        .getState()
                        .openVirtualFile(planPath, planName);
                }
                break;
            }

            case "questions-resolved": {
                const requestId = data.id as string | undefined;
                if (requestId) {
                    useQuestionStore
                        .getState()
                        .clearPendingById(conversationId, requestId);
                } else {
                    useQuestionStore.getState().clearPending(conversationId);
                }
                break;
            }

            case "finish": {
                setOutcome("finished");
                usePermissionStore.getState().clearPending(conversationId);
                useQuestionStore.getState().clearPending(conversationId);
                useConversationStore
                    .getState()
                    .setCompacting(conversationId, false);
                const usage = (data.usage ?? null) as UsageSseEvent | null;
                const assistantMessageId = data.assistantMessageId as
                    | string
                    | undefined;
                const finishedModelId =
                    (data.modelId as string | undefined) ?? null;
                const finishedDurationMs =
                    typeof data.generationDurationMs === "number"
                        ? (data.generationDurationMs as number)
                        : null;
                // Suppress the finish notification only when the user is
                // actively watching this conversation — i.e. the window is
                // focused AND this conversation is the active one. In every
                // other case (window unfocused, or a different conversation
                // active) we fire both the sound and the OS notification
                // (OS notification is additionally gated by focus inside
                // `notify`).
                {
                    const currentState = useConversationStore.getState();
                    const isActiveConvo =
                        currentState.activeConversationId === conversationId;
                    const userIsWatching = isActiveConvo && isWindowFocused();
                    if (!userIsWatching) {
                        notify({
                            kind: "finish",
                            title: "Assistant finished",
                            body: "Assistant has finished its work",
                            conversationId
                        });
                    }
                }
                updateConversation((prev) => ({
                    ...prev,
                    messages: prev.messages.map((m) => {
                        if (m.role === "assistant" && m.isStreaming) {
                            const nowIso = new Date().toISOString();
                            return {
                                ...m,
                                isStreaming: false,
                                isReasoning: false,
                                reasoning_parts: closeOpenReasoningParts(
                                    m.reasoning_parts,
                                    nowIso
                                ),
                                reasoning_ended_at:
                                    m.reasoning_started_at && !m.reasoning_ended_at
                                        ? nowIso
                                        : m.reasoning_ended_at,
                                ...(assistantMessageId &&
                                m.id === assistantMessageId &&
                                usage
                                    ? {
                                          input_tokens: usage.inputTokens,
                                          output_tokens: usage.outputTokens,
                                          reasoning_tokens: usage.reasoningTokens,
                                          total_tokens: usage.totalTokens
                                      }
                                    : {}),
                                ...(assistantMessageId &&
                                m.id === assistantMessageId
                                    ? {
                                          ...(finishedModelId
                                              ? { model_id: finishedModelId }
                                              : {}),
                                          ...(finishedDurationMs !== null
                                              ? {
                                                    generation_duration_ms:
                                                        finishedDurationMs
                                                }
                                              : {})
                                      }
                                    : {})
                            };
                        }
                        return m;
                    })
                }));
                onUsage();
                break;
            }

            case "conversation-title": {
                const title = data.title;
                if (typeof title === "string" && title.length > 0) {
                    const updatedAt =
                        typeof data.updated_at === "string"
                            ? (data.updated_at as string)
                            : null;
                    onConversationTitle(title, updatedAt);
                }
                break;
            }

            case "compaction-started": {
                useConversationStore
                    .getState()
                    .setCompacting(conversationId, true);
                break;
            }

            case "compaction-skipped": {
                useConversationStore
                    .getState()
                    .setCompacting(conversationId, false);
                break;
            }

            case "compaction-error": {
                useConversationStore
                    .getState()
                    .setCompacting(conversationId, false);
                // Error is logged server-side; no destructive UI state to
                // unwind here. The stream will continue without compaction
                // and the model may itself error out if it overflows the
                // context window — that error path already surfaces via the
                // existing `error` SSE handler.
                const errMessage =
                    typeof data.error === "string"
                        ? (data.error as string)
                        : "unknown";
                console.warn(
                    "[conversation-store] Compaction failed:",
                    errMessage
                );
                break;
            }

            case "mid-turn-trim": {
                // Server emitted a one-shot notice that it had to trim
                // oversized tool-result outputs in-flight to keep the
                // current assistant turn under the model's context
                // window. Pure FYI for the client — log for debugging
                // and let the existing breadcrumb handlers surface a
                // visual hint where appropriate.
                const trimmedCount =
                    typeof data.trimmed_count === "number"
                        ? (data.trimmed_count as number)
                        : 0;
                console.info(
                    "[conversation-store] mid-turn tool-result trim:",
                    trimmedCount,
                    "result(s) trimmed in conversation",
                    conversationId
                );
                break;
            }

            case "compacted": {
                useConversationStore
                    .getState()
                    .setCompacting(conversationId, false);
                const evt = data as unknown as CompactedSseEvent;
                const summarizedSet = new Set(evt.summarizedMessageIds);
                updateConversation((prev) => {
                    const hasSummary = prev.messages.some(
                        (m) => m.id === evt.summaryMessageId
                    );
                    const summaryRow = hasSummary
                        ? null
                        : ({
                              id: evt.summaryMessageId,
                              conversation_id: conversationId,
                              role: "system" as const,
                              content: evt.summaryContent,
                              created_at: evt.summaryCreatedAt,
                              compacted: false,
                              summary_of_until: evt.summaryOfUntil
                          } satisfies (typeof prev.messages)[number]);

                    const messages = prev.messages.map((m) =>
                        summarizedSet.has(m.id)
                            ? { ...m, compacted: true }
                            : m
                    );

                    if (summaryRow) {
                        const idx = messages.findIndex(
                            (m) =>
                                new Date(m.created_at).getTime() >
                                new Date(summaryRow.created_at).getTime()
                        );
                        if (idx === -1) {
                            messages.push(summaryRow);
                        } else {
                            messages.splice(idx, 0, summaryRow);
                        }
                    }

                    return { ...prev, messages };
                });
                onCompacted(evt);
                break;
            }

            case "abort": {
                setOutcome("aborted");
                usePermissionStore.getState().clearPending(conversationId);
                useQuestionStore.getState().clearPending(conversationId);
                useConversationStore
                    .getState()
                    .setCompacting(conversationId, false);
                const abortedModelId =
                    (data.modelId as string | undefined) ?? null;
                const abortedDurationMs =
                    typeof data.generationDurationMs === "number"
                        ? (data.generationDurationMs as number)
                        : null;
                const abortedAssistantMessageId = data.assistantMessageId as
                    | string
                    | undefined;
                updateConversation((prev) => {
                    const lastStreamingAssistantIndex = [...prev.messages]
                        .map((message, index) => ({ message, index }))
                        .reverse()
                        .find(
                            ({ message }) =>
                                message.role === "assistant" && message.isStreaming
                        )?.index;

                    if (lastStreamingAssistantIndex == null) {
                        return prev;
                    }

                    const messages = prev.messages.flatMap((message, index) => {
                        if (index !== lastStreamingAssistantIndex) {
                            return [message];
                        }

                        if (isAssistantMessageEmpty(message)) {
                            return [];
                        }

                        const nowIso = new Date().toISOString();
                        const shouldApplyAbortMetadata =
                            !abortedAssistantMessageId ||
                            message.id === abortedAssistantMessageId;
                        return [
                            {
                                ...message,
                                isStreaming: false,
                                isReasoning: false,
                                reasoning_parts: closeOpenReasoningParts(
                                    message.reasoning_parts,
                                    nowIso
                                ),
                                reasoning_ended_at:
                                    message.reasoning_started_at &&
                                    !message.reasoning_ended_at
                                        ? nowIso
                                        : message.reasoning_ended_at,
                                ...(shouldApplyAbortMetadata && abortedModelId
                                    ? { model_id: abortedModelId }
                                    : {}),
                                ...(shouldApplyAbortMetadata &&
                                abortedDurationMs !== null
                                    ? {
                                          generation_duration_ms:
                                              abortedDurationMs
                                      }
                                    : {})
                            }
                        ];
                    });

                    return { ...prev, messages };
                });
                break;
            }

            case "error": {
                setOutcome("errored");
                usePermissionStore.getState().clearPending(conversationId);
                useQuestionStore.getState().clearPending(conversationId);
                useConversationStore
                    .getState()
                    .setCompacting(conversationId, false);
                updateConversation((prev) => ({
                    ...prev,
                    messages: prev.messages.filter(
                        (m) => !(m.role === "assistant" && m.isStreaming)
                    )
                }));
                break;
            }

            case "subagent-started": {
                onSubagentStarted(data as unknown as SubagentStartedEvent);
                break;
            }

            case "subagent-finished": {
                onSubagentFinished(data as unknown as SubagentFinishedEvent);
                break;
            }
        }
}

async function runStream(
    conversationId: string,
    response: Response,
    callbacks: Omit<SseHandlerCallbacks, "setOutcome">
): Promise<StreamOutcome> {
    let outcome: StreamOutcome = "aborted";
    const withSetter: SseHandlerCallbacks = {
        ...callbacks,
        setOutcome: (value) => {
            outcome = value;
        }
    };
    await consumeSseStream(response, (event, data) => {
        handleConversationSseEvent(conversationId, event, data, withSetter);
    });
    return outcome;
}

export const useConversationStore = create<ConversationStoreState>()((set, get) => {
    function applyConversationUpdate(
        conversationId: string,
        updater: (prev: ConversationWithMessages) => ConversationWithMessages
    ) {
        set((state) => {
            const existing = state.conversationsById[conversationId];
            if (!existing) return {};
            return {
                conversationsById: {
                    ...state.conversationsById,
                    [conversationId]: updater(existing)
                }
            };
        });
    }

    async function runConversationStream(
        conversationId: string,
        startRequest: (signal: AbortSignal) => Promise<Response>
    ): Promise<void> {
        if (get().streamControllersById[conversationId]) {
            return;
        }

        const controller = new AbortController();
        set((state) => ({
            streamControllersById: {
                ...state.streamControllersById,
                [conversationId]: controller
            }
        }));

        let outcome: StreamOutcome = "aborted";

        try {
            const response = await startRequest(controller.signal);
            outcome = await runStream(conversationId, response, {
                updateConversation: (updater) =>
                    applyConversationUpdate(conversationId, updater),
                onCompacted: () => {
                    get().bumpContextRefresh(conversationId);
                },
                onUsage: () => {
                    get().bumpContextRefresh(conversationId);
                },
                onConversationTitle: (title, updatedAt) => {
                    applyConversationUpdate(conversationId, (prev) => ({
                        ...prev,
                        title,
                        updated_at: updatedAt ?? prev.updated_at
                    }));
                    set((state) => {
                        const entries = Object.entries(
                            state.conversationsByWorkspace
                        );
                        let changed = false;
                        const nextByWorkspace: Record<string, Conversation[]> =
                            {};
                        for (const [workspaceId, conversations] of entries) {
                            let workspaceChanged = false;
                            const nextConversations = conversations.map(
                                (conversation) => {
                                    if (conversation.id !== conversationId) {
                                        return conversation;
                                    }
                                    workspaceChanged = true;
                                    return {
                                        ...conversation,
                                        title,
                                        updated_at:
                                            updatedAt ??
                                            conversation.updated_at
                                    };
                                }
                            );
                            nextByWorkspace[workspaceId] = workspaceChanged
                                ? nextConversations
                                : conversations;
                            if (workspaceChanged) {
                                changed = true;
                            }
                        }
                        if (!changed) return {};
                        return { conversationsByWorkspace: nextByWorkspace };
                    });
                },
                onSubagentStarted: (event) => {
                    const parentId = event.parent_conversation_id;
                    const sub = event.subagent;
                    const now = new Date().toISOString();
                    const entry: Conversation = {
                        id: sub.id,
                        title: sub.title,
                        created_at: sub.startedAt,
                        updated_at: sub.startedAt ?? now,
                        parent_conversation_id: parentId,
                        subagent_type: sub.subagentType,
                        subagent_name: sub.subagentName,
                        hidden: true
                    };
                    set((state) => {
                        const existing =
                            state.subagentsByParentId[parentId] ?? [];
                        if (existing.some((c) => c.id === entry.id)) {
                            return {};
                        }
                        return {
                            subagentsByParentId: {
                                ...state.subagentsByParentId,
                                [parentId]: [...existing, entry]
                            }
                        };
                    });
                    // Link the spawned subagent to its task tool invocation
                    // in the parent's assistant message so TaskBlock can
                    // render a deep-link + breadcrumb immediately.
                    applyConversationUpdate(parentId, (prev) => ({
                        ...prev,
                        messages: prev.messages.map((m) => {
                            if (m.id !== event.messageId) return m;
                            const existing = m.tool_invocations ?? [];
                            let linked = false;
                            const tool_invocations = existing.map((inv) => {
                                if (linked) return inv;
                                if (inv.tool_name !== "task") return inv;
                                if (inv.subagent_id) return inv;
                                linked = true;
                                return { ...inv, subagent_id: sub.id };
                            });
                            return linked
                                ? { ...m, tool_invocations }
                                : m;
                        })
                    }));
                },
                onSubagentFinished: (event) => {
                    const parentId = event.parent_conversation_id;
                    set((state) => {
                        const existing =
                            state.subagentsByParentId[parentId] ?? [];
                        if (existing.length === 0) return {};
                        return {
                            subagentsByParentId: {
                                ...state.subagentsByParentId,
                                [parentId]: existing.map((c) =>
                                    c.id === event.subagent_id
                                        ? {
                                              ...c,
                                              updated_at: event.ended_at
                                          }
                                        : c
                                )
                            }
                        };
                    });
                }
            });
        } catch (error) {
            if (!isAbortError(error) && !controller.signal.aborted) {
                outcome = "errored";
                throw error;
            }
        } finally {
            set((state) => ({
                streamControllersById: omitKey(
                    state.streamControllersById,
                    conversationId
                )
            }));

            usePermissionStore.getState().clearPending(conversationId);
            useQuestionStore.getState().clearPending(conversationId);

            applyConversationUpdate(conversationId, (prev) => ({
                ...prev,
                messages: finalizeStreamingMessages(prev.messages)
            }));

            if (
                outcome === "finished" &&
                get().activeConversationId !== conversationId
            ) {
                set((state) => ({
                    unreadConversationIds: {
                        ...state.unreadConversationIds,
                        [conversationId]: true
                    }
                }));
            }
        }
    }

    return {
        conversationsByWorkspace: {},
        archivedByWorkspace: {},
        conversationsById: {},
        activeConversationId: null,
        isLoadingList: false,
        loadingConversationIds: {},
        streamControllersById: {},
        observerControllersById: {},
        unreadConversationIds: {},
        contextByConversationId: {},
        contextRefreshTokens: {},
        subagentsByParentId: {},
        compactingByConversationId: {},

        setContextSummary: (
            conversationId: string,
            summary: ContextSummary
        ) => {
            set((state) => ({
                contextByConversationId: {
                    ...state.contextByConversationId,
                    [conversationId]: summary
                }
            }));
        },

        bumpContextRefresh: (conversationId: string) => {
            set((state) => ({
                contextRefreshTokens: {
                    ...state.contextRefreshTokens,
                    [conversationId]:
                        (state.contextRefreshTokens[conversationId] ?? 0) + 1
                }
            }));
        },

        setCompacting: (conversationId: string, compacting: boolean) => {
            set((state) => {
                if (compacting) {
                    if (state.compactingByConversationId[conversationId]) {
                        return {};
                    }
                    return {
                        compactingByConversationId: {
                            ...state.compactingByConversationId,
                            [conversationId]: true
                        }
                    };
                }
                if (!state.compactingByConversationId[conversationId]) {
                    return {};
                }
                return {
                    compactingByConversationId: omitKey(
                        state.compactingByConversationId,
                        conversationId
                    )
                };
            });
        },

        setActiveConversation: (conversationId: string | null) => {
            set((state) => {
                const patch: Partial<ConversationStoreState> = {
                    activeConversationId: conversationId
                };
                if (conversationId && state.unreadConversationIds[conversationId]) {
                    patch.unreadConversationIds = omitKey(
                        state.unreadConversationIds,
                        conversationId
                    );
                }
                return patch;
            });
        },

        markConversationRead: (conversationId: string) => {
            set((state) => {
                if (!state.unreadConversationIds[conversationId]) return {};
                return {
                    unreadConversationIds: omitKey(
                        state.unreadConversationIds,
                        conversationId
                    )
                };
            });
        },

        stopGeneration: (conversationId?: string) => {
            const targetId = conversationId ?? get().activeConversationId;
            if (!targetId) return;
            const controller = get().streamControllersById[targetId];
            if (!controller) return;
            controller.abort();
            usePermissionStore.getState().clearPending(targetId);
            useQuestionStore.getState().clearPending(targetId);
            set((state) => ({
                streamControllersById: omitKey(
                    state.streamControllersById,
                    targetId
                )
            }));
        },

        loadConversations: async (workspaceId: string) => {
            const hadCached = workspaceId in get().conversationsByWorkspace;
            if (!hadCached) set({ isLoadingList: true });
            try {
                const conversations =
                    await conversationApi.fetchConversations(workspaceId);
                set((state) => ({
                    conversationsByWorkspace: {
                        ...state.conversationsByWorkspace,
                        [workspaceId]: conversations
                    }
                }));
            } finally {
                if (!hadCached) set({ isLoadingList: false });
            }
        },

        loadArchivedConversations: async (workspaceId: string) => {
            try {
                const { conversations } =
                    await conversationApi.fetchArchivedConversations(
                        workspaceId
                    );
                set((state) => ({
                    archivedByWorkspace: {
                        ...state.archivedByWorkspace,
                        [workspaceId]: conversations
                    }
                }));
            } catch (error) {
                console.error(
                    "[conversation-store] loadArchivedConversations failed",
                    error
                );
            }
        },

        loadSubagents: async (
            workspaceId: string,
            parentConversationId: string
        ) => {
            try {
                const { subagents } = await conversationApi.fetchSubagents(
                    workspaceId,
                    parentConversationId
                );
                set((state) => ({
                    subagentsByParentId: {
                        ...state.subagentsByParentId,
                        [parentConversationId]: subagents
                    }
                }));
            } catch (error) {
                console.error("[conversation-store] loadSubagents failed", error);
            }
        },

        observeConversation: (
            workspaceId: string,
            conversationId: string
        ): (() => void) => {
            const existing = get().observerControllersById[conversationId];
            if (existing) {
                return () => {
                    existing.abort();
                    set((state) => ({
                        observerControllersById: omitKey(
                            state.observerControllersById,
                            conversationId
                        )
                    }));
                };
            }

            const controller = new AbortController();
            set((state) => ({
                observerControllersById: {
                    ...state.observerControllersById,
                    [conversationId]: controller
                }
            }));

            // Launch async but return a dispose function immediately.
            void (async () => {
                try {
                    const response =
                        await conversationApi.observeConversationEvents(
                            workspaceId,
                            conversationId,
                            controller.signal
                        );

                    const callbacks: Omit<SseHandlerCallbacks, "setOutcome"> = {
                        updateConversation: (updater) =>
                            applyConversationUpdate(conversationId, updater),
                        onCompacted: () => {
                            get().bumpContextRefresh(conversationId);
                        },
                        onUsage: () => {
                            get().bumpContextRefresh(conversationId);
                        },
                        onConversationTitle: (title, updatedAt) => {
                            applyConversationUpdate(
                                conversationId,
                                (prev) => ({
                                    ...prev,
                                    title,
                                    updated_at:
                                        updatedAt ?? prev.updated_at
                                })
                            );
                        },
                        onSubagentStarted: () => {},
                        onSubagentFinished: () => {}
                    };

                    await runStream(conversationId, response, callbacks);
                } catch (error) {
                    if (!isAbortError(error)) {
                        console.error(
                            "[conversation-store] observer stream failed",
                            error
                        );
                    }
                } finally {
                    set((state) => ({
                        observerControllersById: omitKey(
                            state.observerControllersById,
                            conversationId
                        )
                    }));
                }
            })();

            return () => {
                controller.abort();
                set((state) => ({
                    observerControllersById: omitKey(
                        state.observerControllersById,
                        conversationId
                    )
                }));
            };
        },

        loadConversation: async (
            workspaceId: string,
            conversationId: string
        ) => {
            set((state) => {
                const patch: Partial<ConversationStoreState> = {
                    activeConversationId: conversationId
                };
                if (state.unreadConversationIds[conversationId]) {
                    patch.unreadConversationIds = omitKey(
                        state.unreadConversationIds,
                        conversationId
                    );
                }
                return patch;
            });

            const state = get();

            // Already in memory (may be streaming) — nothing to fetch.
            if (state.conversationsById[conversationId]) {
                return;
            }

            if (state.loadingConversationIds[conversationId]) {
                return;
            }

            set((s) => ({
                loadingConversationIds: {
                    ...s.loadingConversationIds,
                    [conversationId]: true
                }
            }));

            try {
                const conversation = await conversationApi.fetchConversation(
                    workspaceId,
                    conversationId
                );

                set((s) => {
                    const next: Partial<ConversationStoreState> = {
                        loadingConversationIds: omitKey(
                            s.loadingConversationIds,
                            conversationId
                        )
                    };

                    // Don't clobber a stream that populated state while
                    // the fetch was in flight.
                    if (!s.conversationsById[conversationId]) {
                        next.conversationsById = {
                            ...s.conversationsById,
                            [conversationId]: conversation
                        };
                    }

                    return next;
                });
            } catch (error) {
                set((s) => ({
                    loadingConversationIds: omitKey(
                        s.loadingConversationIds,
                        conversationId
                    )
                }));
                throw error;
            }
        },

        createConversation: async (
            workspaceId: string,
            message: string,
            attachmentIds: string[] = [],
            mentions: conversationApi.MessageMention[] = []
        ) => {
            const conversation = await conversationApi.createConversation(
                workspaceId,
                message,
                attachmentIds,
                mentions
            );

            set((state) => {
                const existing =
                    state.conversationsByWorkspace[workspaceId] ?? [];
                return {
                    activeConversationId: conversation.id,
                    conversationsById: {
                        ...state.conversationsById,
                        [conversation.id]: conversation
                    },
                    conversationsByWorkspace: {
                        ...state.conversationsByWorkspace,
                        [workspaceId]: [conversation, ...existing]
                    }
                };
            });

            return conversation;
        },

        sendMessage: async (
            workspaceId: string,
            conversationId: string,
            content: string,
            attachmentIds: string[] = [],
            mentions: conversationApi.MessageMention[] = []
        ) => {
            await runConversationStream(conversationId, (signal) =>
                conversationApi.streamMessage(
                    workspaceId,
                    conversationId,
                    content,
                    signal,
                    attachmentIds,
                    mentions
                )
            );
        },

        replyToConversation: async (
            workspaceId: string,
            conversationId: string
        ) => {
            await runConversationStream(conversationId, (signal) =>
                conversationApi.replyToConversation(
                    workspaceId,
                    conversationId,
                    signal
                )
            );
        },

        archiveConversation: async (
            workspaceId: string,
            conversationId: string
        ) => {
            // Snapshot the conversation row from the active list so we can
            // optimistically move it into the archived bucket. Fall back to
            // a synthesized stub if (somehow) it's not in the active list
            // anymore — the optimistic move stays consistent and the API
            // call is the source of truth on `archived_at`.
            const state = get();
            const active =
                state.conversationsByWorkspace[workspaceId] ?? [];
            const target = active.find((c) => c.id === conversationId);
            const archivedNow = new Date().toISOString();
            const optimisticArchivedRow: Conversation = target
                ? { ...target, archived_at: archivedNow }
                : {
                      id: conversationId,
                      title: "Archived conversation",
                      created_at: archivedNow,
                      updated_at: archivedNow,
                      archived_at: archivedNow
                  };

            set((s) => {
                const existingActive =
                    s.conversationsByWorkspace[workspaceId] ?? [];
                const existingArchived =
                    s.archivedByWorkspace[workspaceId] ?? [];
                return {
                    conversationsByWorkspace: {
                        ...s.conversationsByWorkspace,
                        [workspaceId]: existingActive.filter(
                            (c) => c.id !== conversationId
                        )
                    },
                    archivedByWorkspace: {
                        ...s.archivedByWorkspace,
                        [workspaceId]: [
                            optimisticArchivedRow,
                            ...existingArchived.filter(
                                (c) => c.id !== conversationId
                            )
                        ]
                    },
                    activeConversationId:
                        s.activeConversationId === conversationId
                            ? null
                            : s.activeConversationId
                };
            });

            try {
                const { archived_at } =
                    await conversationApi.archiveConversation(
                        workspaceId,
                        conversationId
                    );
                set((s) => {
                    const existingArchived =
                        s.archivedByWorkspace[workspaceId] ?? [];
                    return {
                        archivedByWorkspace: {
                            ...s.archivedByWorkspace,
                            [workspaceId]: existingArchived.map((c) =>
                                c.id === conversationId
                                    ? { ...c, archived_at }
                                    : c
                            )
                        }
                    };
                });
            } catch (error) {
                // Revert on failure — restore the row to the active list
                // and drop it from the archived bucket.
                set((s) => {
                    const existingActive =
                        s.conversationsByWorkspace[workspaceId] ?? [];
                    const existingArchived =
                        s.archivedByWorkspace[workspaceId] ?? [];
                    const restored: Conversation = {
                        ...optimisticArchivedRow,
                        archived_at: null
                    };
                    return {
                        conversationsByWorkspace: {
                            ...s.conversationsByWorkspace,
                            [workspaceId]: [
                                restored,
                                ...existingActive.filter(
                                    (c) => c.id !== conversationId
                                )
                            ]
                        },
                        archivedByWorkspace: {
                            ...s.archivedByWorkspace,
                            [workspaceId]: existingArchived.filter(
                                (c) => c.id !== conversationId
                            )
                        }
                    };
                });
                throw error;
            }
        },

        unarchiveConversation: async (
            workspaceId: string,
            conversationId: string
        ) => {
            const state = get();
            const archived =
                state.archivedByWorkspace[workspaceId] ?? [];
            const target = archived.find((c) => c.id === conversationId);
            if (!target) {
                // Nothing to unarchive in our local cache. Still hit the
                // server to be safe — the list reload below will reconcile.
                await conversationApi.unarchiveConversation(
                    workspaceId,
                    conversationId
                );
                return;
            }
            const optimisticActiveRow: Conversation = {
                ...target,
                archived_at: null
            };

            set((s) => {
                const existingActive =
                    s.conversationsByWorkspace[workspaceId] ?? [];
                const existingArchived =
                    s.archivedByWorkspace[workspaceId] ?? [];
                return {
                    archivedByWorkspace: {
                        ...s.archivedByWorkspace,
                        [workspaceId]: existingArchived.filter(
                            (c) => c.id !== conversationId
                        )
                    },
                    conversationsByWorkspace: {
                        ...s.conversationsByWorkspace,
                        [workspaceId]: [
                            optimisticActiveRow,
                            ...existingActive.filter(
                                (c) => c.id !== conversationId
                            )
                        ]
                    }
                };
            });

            try {
                await conversationApi.unarchiveConversation(
                    workspaceId,
                    conversationId
                );
            } catch (error) {
                set((s) => {
                    const existingActive =
                        s.conversationsByWorkspace[workspaceId] ?? [];
                    const existingArchived =
                        s.archivedByWorkspace[workspaceId] ?? [];
                    return {
                        conversationsByWorkspace: {
                            ...s.conversationsByWorkspace,
                            [workspaceId]: existingActive.filter(
                                (c) => c.id !== conversationId
                            )
                        },
                        archivedByWorkspace: {
                            ...s.archivedByWorkspace,
                            [workspaceId]: [
                                target,
                                ...existingArchived.filter(
                                    (c) => c.id !== conversationId
                                )
                            ]
                        }
                    };
                });
                throw error;
            }
        },

        deleteConversation: async (
            workspaceId: string,
            conversationId: string
        ) => {
            get().streamControllersById[conversationId]?.abort();
            usePermissionStore.getState().clearPending(conversationId);
            useQuestionStore.getState().clearPending(conversationId);
            useTodoStore.getState().clearTodos(conversationId);

            await conversationApi.deleteConversation(
                workspaceId,
                conversationId
            );

            set((state) => {
                const existingActive =
                    state.conversationsByWorkspace[workspaceId] ?? [];
                const existingArchived =
                    state.archivedByWorkspace[workspaceId] ?? [];

                return {
                    conversationsByWorkspace: {
                        ...state.conversationsByWorkspace,
                        [workspaceId]: existingActive.filter(
                            (c) => c.id !== conversationId
                        )
                    },
                    archivedByWorkspace: {
                        ...state.archivedByWorkspace,
                        [workspaceId]: existingArchived.filter(
                            (c) => c.id !== conversationId
                        )
                    },
                    conversationsById: omitKey(
                        state.conversationsById,
                        conversationId
                    ),
                    streamControllersById: omitKey(
                        state.streamControllersById,
                        conversationId
                    ),
                    unreadConversationIds: omitKey(
                        state.unreadConversationIds,
                        conversationId
                    ),
                    loadingConversationIds: omitKey(
                        state.loadingConversationIds,
                        conversationId
                    ),
                    contextByConversationId: omitKey(
                        state.contextByConversationId,
                        conversationId
                    ),
                    contextRefreshTokens: omitKey(
                        state.contextRefreshTokens,
                        conversationId
                    ),
                    activeConversationId:
                        state.activeConversationId === conversationId
                            ? null
                            : state.activeConversationId
                };
            });
        },

        clearActiveConversation: () => {
            set({ activeConversationId: null });
        }
    };
});
