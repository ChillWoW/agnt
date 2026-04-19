import { logger } from "../../../lib/logger";

export interface QuestionOptionSpec {
    label: string;
    description: string;
}

export interface QuestionSpec {
    question: string;
    header: string;
    options: QuestionOptionSpec[];
    multiple: boolean;
}

export interface QuestionsRequestInit {
    conversationId: string;
    questions: QuestionSpec[];
}

export interface QuestionsRequest extends QuestionsRequestInit {
    id: string;
    createdAt: string;
}

export interface QuestionsResult {
    cancelled: boolean;
    answers: string[][];
}

interface PendingQuestions {
    request: QuestionsRequest;
    resolve: (result: QuestionsResult) => void;
    reject: (reason: Error) => void;
}

const pendingById = new Map<string, PendingQuestions>();
const pendingByConversation = new Map<string, Set<string>>();

type QuestionsListener = (event: QuestionsGateEvent) => void;

export type QuestionsGateEvent =
    | { type: "requested"; request: QuestionsRequest }
    | {
          type: "resolved";
          requestId: string;
          answers: string[][];
          cancelled: boolean;
      };

const listenersByConversation = new Map<string, Set<QuestionsListener>>();

function notify(conversationId: string, event: QuestionsGateEvent): void {
    const listeners = listenersByConversation.get(conversationId);
    if (!listeners) return;
    for (const listener of listeners) {
        try {
            listener(event);
        } catch (error) {
            logger.error("[questions] listener threw", error);
        }
    }
}

export function subscribeToQuestions(
    conversationId: string,
    listener: QuestionsListener
): () => void {
    const set = listenersByConversation.get(conversationId) ?? new Set();
    set.add(listener);
    listenersByConversation.set(conversationId, set);

    return () => {
        const current = listenersByConversation.get(conversationId);
        if (!current) return;
        current.delete(listener);
        if (current.size === 0) {
            listenersByConversation.delete(conversationId);
        }
    };
}

export function requestQuestions(
    init: QuestionsRequestInit
): Promise<QuestionsResult> {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const request: QuestionsRequest = { ...init, id, createdAt };

    return new Promise<QuestionsResult>((resolve, reject) => {
        pendingById.set(id, { request, resolve, reject });

        const perConversation =
            pendingByConversation.get(init.conversationId) ?? new Set();
        perConversation.add(id);
        pendingByConversation.set(init.conversationId, perConversation);

        notify(init.conversationId, { type: "requested", request });
    });
}

function validateAnswerShape(
    request: QuestionsRequest,
    answers: string[][]
): { ok: true } | { ok: false; error: string } {
    if (!Array.isArray(answers)) {
        return { ok: false, error: "'answers' must be an array" };
    }
    if (answers.length !== request.questions.length) {
        return {
            ok: false,
            error: `Expected ${request.questions.length} answer groups, got ${answers.length}`
        };
    }
    for (let i = 0; i < answers.length; i++) {
        const group = answers[i];
        if (!Array.isArray(group)) {
            return {
                ok: false,
                error: `answers[${i}] must be an array of strings`
            };
        }
        for (let j = 0; j < group.length; j++) {
            if (typeof group[j] !== "string") {
                return {
                    ok: false,
                    error: `answers[${i}][${j}] must be a string`
                };
            }
        }
        const spec = request.questions[i];
        if (spec && spec.multiple === false && group.length > 1) {
            return {
                ok: false,
                error: `answers[${i}] may have at most 1 entry because question is single-select`
            };
        }
        if (group.length === 0) {
            return {
                ok: false,
                error: `answers[${i}] must have at least one entry`
            };
        }
    }
    return { ok: true };
}

export function resolveQuestions(
    requestId: string,
    answers: string[][]
): { ok: true } | { ok: false; error: string } {
    const pending = pendingById.get(requestId);
    if (!pending) {
        return {
            ok: false,
            error: `Questions request not found: ${requestId}`
        };
    }

    const validation = validateAnswerShape(pending.request, answers);
    if (!validation.ok) {
        return validation;
    }

    pendingById.delete(requestId);
    const perConversation = pendingByConversation.get(
        pending.request.conversationId
    );
    perConversation?.delete(requestId);
    if (perConversation && perConversation.size === 0) {
        pendingByConversation.delete(pending.request.conversationId);
    }

    pending.resolve({ cancelled: false, answers });
    notify(pending.request.conversationId, {
        type: "resolved",
        requestId,
        answers,
        cancelled: false
    });

    return { ok: true };
}

export function cancelQuestions(
    requestId: string
): { ok: true } | { ok: false; error: string } {
    const pending = pendingById.get(requestId);
    if (!pending) {
        return {
            ok: false,
            error: `Questions request not found: ${requestId}`
        };
    }

    pendingById.delete(requestId);
    const perConversation = pendingByConversation.get(
        pending.request.conversationId
    );
    perConversation?.delete(requestId);
    if (perConversation && perConversation.size === 0) {
        pendingByConversation.delete(pending.request.conversationId);
    }

    // Cancelled questions resolve the tool call with an empty-answer payload
    // so the LLM can inspect the cancelled flag and continue generation
    // instead of aborting the whole stream.
    pending.resolve({ cancelled: true, answers: [] });
    notify(pending.request.conversationId, {
        type: "resolved",
        requestId,
        answers: [],
        cancelled: true
    });

    return { ok: true };
}

export function abortQuestions(
    conversationId: string,
    reason = "aborted"
): void {
    const ids = pendingByConversation.get(conversationId);
    if (!ids) return;

    for (const id of ids) {
        const pending = pendingById.get(id);
        if (!pending) continue;
        pendingById.delete(id);
        pending.reject(new Error(reason));
        // Notify with an empty answer set so listeners can clear UI state.
        notify(conversationId, {
            type: "resolved",
            requestId: id,
            answers: [],
            cancelled: true
        });
    }

    pendingByConversation.delete(conversationId);
}

export function clearConversationQuestionState(conversationId: string): void {
    abortQuestions(conversationId, "conversation-cleared");
    listenersByConversation.delete(conversationId);
}
