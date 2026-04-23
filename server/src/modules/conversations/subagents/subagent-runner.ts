import { logger } from "../../../lib/logger";
import { createSubagentConversation } from "../conversations.service";
import { runSubagentStream } from "../conversation.stream";
import type { ReasoningEffort } from "../../models/models.types";
import type { SubagentType } from "../conversations.types";
import { pickSubagentName } from "./names";
import {
    registerSubagent,
    unregisterSubagent,
    type SubagentMeta
} from "./subagent-registry";

export interface RunSubagentParams {
    workspaceId: string;
    parentConversationId: string;
    subagentType: SubagentType;
    description: string;
    prompt: string;
    modelOverride?: string;
    reasoningEffortOverride?: ReasoningEffort | null;
    parentAbortSignal?: AbortSignal;
}

export interface RunSubagentResult {
    subagentId: string;
    subagentName: string;
    subagentType: SubagentType;
    finalText: string;
    aborted: boolean;
}

function chainAbortSignal(
    parent: AbortSignal | undefined,
    childController: AbortController
): () => void {
    if (!parent) return () => {};
    if (parent.aborted) {
        try {
            childController.abort(parent.reason);
        } catch {
            // noop
        }
        return () => {};
    }
    const onAbort = () => {
        try {
            childController.abort(parent.reason);
        } catch {
            // noop
        }
    };
    parent.addEventListener("abort", onAbort, { once: true });
    return () => parent.removeEventListener("abort", onAbort);
}

export async function runSubagent(
    params: RunSubagentParams
): Promise<RunSubagentResult> {
    const {
        workspaceId,
        parentConversationId,
        subagentType,
        description,
        prompt,
        modelOverride,
        reasoningEffortOverride,
        parentAbortSignal
    } = params;

    const subagentName = pickSubagentName();
    const title = description.trim().slice(0, 80) || "Subagent task";
    const conversation = createSubagentConversation(workspaceId, {
        parentConversationId,
        subagentType,
        subagentName,
        title,
        initialUserMessage: prompt
    });

    const startedAt = new Date().toISOString();
    const meta: SubagentMeta = {
        id: conversation.id,
        parentConversationId,
        subagentType,
        subagentName,
        title,
        startedAt
    };

    const childController = new AbortController();
    const unchainParent = chainAbortSignal(parentAbortSignal, childController);

    registerSubagent(meta, childController);

    logger.log("[subagent] started", {
        id: conversation.id,
        parent: parentConversationId,
        subagentType,
        subagentName
    });

    let outcome: "success" | "error" | "aborted" = "success";
    let finalText = "";
    let error: string | null = null;
    let aborted = false;

    try {
        const streamResult = await runSubagentStream({
            workspaceId,
            conversationId: conversation.id,
            abortSignal: childController.signal,
            subagentType,
            modelOverride,
            reasoningEffortOverride
        });
        finalText = streamResult.finalText;
        aborted = streamResult.aborted;
        outcome = aborted ? "aborted" : "success";
    } catch (err) {
        outcome = childController.signal.aborted ? "aborted" : "error";
        aborted = childController.signal.aborted;
        error =
            err instanceof Error ? err.message : "Subagent stream failed";
        logger.error("[subagent] stream failed", {
            id: conversation.id,
            error: err
        });
    } finally {
        unchainParent();
        unregisterSubagent(
            conversation.id,
            outcome,
            finalText || null,
            error
        );
    }

    if (outcome === "error" && error) {
        throw new Error(`Subagent failed: ${error}`);
    }

    return {
        subagentId: conversation.id,
        subagentName,
        subagentType,
        finalText,
        aborted
    };
}
