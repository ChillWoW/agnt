import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { RobotIcon } from "@phosphor-icons/react";
import type {
    SubagentType,
    ToolInvocation
} from "@/features/conversations/conversation-types";
import { useConversationStore } from "@/features/conversations/conversation-store";
import { ToolBlock } from "./shared/ToolBlock";
import { isRecord } from "./shared/format";

interface TaskInputShape {
    subagent_type?: string;
    description?: string;
    prompt?: string;
    model?: string;
}

interface TaskOutputShape {
    subagentId?: string;
    subagentName?: string;
    subagentType?: string;
    finalText?: string;
    aborted?: boolean;
}

const SUBAGENT_TYPE_LABEL: Record<SubagentType, string> = {
    generalPurpose: "General",
    explore: "Explore",
    shell: "Shell",
    docs: "Docs",
    "best-of-n-runner": "Best-of-N"
};

export function TaskBlock({ invocation }: { invocation: ToolInvocation }) {
    const input: TaskInputShape = isRecord(invocation.input)
        ? (invocation.input as TaskInputShape)
        : {};
    const output: TaskOutputShape | undefined = isRecord(invocation.output)
        ? (invocation.output as TaskOutputShape)
        : undefined;

    // subagent_id is hydrated (a) live via subagent-started and (b) from
    // output.subagentId for completed rows. Prefer the live link so the
    // card is clickable the moment the subagent row exists.
    const subagentId =
        invocation.subagent_id ?? output?.subagentId ?? undefined;

    // Pull live subagent metadata (name, type, latest assistant text snippet)
    // from the parent's subagentsByParentId map + the subagent conversation
    // if it has been hydrated via observeConversation.
    const subagentConversation = useConversationStore((s) =>
        subagentId ? s.conversationsById[subagentId] : undefined
    );
    const parentId = subagentConversation?.parent_conversation_id ?? null;
    const parentSubagents = useConversationStore((s) =>
        parentId ? s.subagentsByParentId[parentId] : undefined
    );
    const liveSubagent = useMemo(() => {
        if (!subagentId || !parentSubagents) return undefined;
        return parentSubagents.find((c) => c.id === subagentId);
    }, [parentSubagents, subagentId]);

    const subagentName =
        output?.subagentName ??
        liveSubagent?.subagent_name ??
        subagentConversation?.subagent_name ??
        null;
    const subagentTypeRaw =
        (output?.subagentType as SubagentType | undefined) ??
        (liveSubagent?.subagent_type as SubagentType | null | undefined) ??
        (subagentConversation?.subagent_type as
            | SubagentType
            | null
            | undefined) ??
        (input.subagent_type as SubagentType | undefined);
    const subagentTypeLabel =
        subagentTypeRaw && subagentTypeRaw in SUBAGENT_TYPE_LABEL
            ? SUBAGENT_TYPE_LABEL[subagentTypeRaw as SubagentType]
            : (subagentTypeRaw ?? "subagent");

    const isPending = invocation.status === "pending";
    const wasAborted = output?.aborted === true;

    const header = subagentName
        ? `${subagentName} · ${subagentTypeLabel}`
        : `Subagent · ${subagentTypeLabel}`;
    const pendingLabel = `${header} · working`;
    const successLabel = wasAborted
        ? `${header} · aborted`
        : `${header} · done`;
    const errorLabel = `${header} · failed`;
    const deniedLabel = `${header} · denied`;

    // Build a live preview of the last streamed assistant text while the
    // subagent is still running. Falls back to the tool-output finalText
    // once the subagent finishes.
    const livePreview = useMemo(() => {
        if (!subagentConversation) return "";
        const messages = subagentConversation.messages ?? [];
        for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            if (msg?.role === "assistant" && msg.content.length > 0) {
                return msg.content;
            }
        }
        return "";
    }, [subagentConversation]);

    const bodyText =
        (!isPending && output?.finalText) ||
        livePreview ||
        input.prompt ||
        "";

    const detailBits: string[] = [];
    if (input.description && input.description.length > 0) {
        detailBits.push(input.description);
    }
    const detail = detailBits.join(" · ") || undefined;

    const cardIcon = <RobotIcon className="size-3.5" weight="bold" />;

    const card = (
        <ToolBlock
            icon={cardIcon}
            pendingLabel={pendingLabel}
            successLabel={successLabel}
            errorLabel={errorLabel}
            deniedLabel={deniedLabel}
            detail={detail}
            error={invocation.error}
            status={invocation.status}
            autoOpen
            autoClose
        >
            <div className="flex flex-col gap-1.5 py-1">
                {bodyText && (
                    <p className="whitespace-pre-wrap text-xs leading-relaxed text-dark-300">
                        {bodyText.length > 600
                            ? `${bodyText.slice(-600)}`
                            : bodyText}
                    </p>
                )}
                {subagentId && (
                    <p className="text-[11px] leading-relaxed text-dark-400">
                        Click to open {subagentName ?? "subagent"}'s live view
                        →
                    </p>
                )}
                {invocation.error && (
                    <p className="whitespace-pre-wrap text-xs leading-relaxed text-red-200">
                        {invocation.error}
                    </p>
                )}
            </div>
        </ToolBlock>
    );

    if (!subagentId) {
        return card;
    }

    return (
        <Link
            to="/conversations/$conversationId"
            params={{ conversationId: subagentId }}
            className="block no-underline"
            aria-label={`Open subagent ${subagentName ?? "conversation"}`}
        >
            {card}
        </Link>
    );
}
