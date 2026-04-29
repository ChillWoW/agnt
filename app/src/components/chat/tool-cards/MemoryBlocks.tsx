import { BrainIcon, TrashIcon } from "@phosphor-icons/react";
import type { ToolInvocation } from "@/features/conversations/conversation-types";
import { ToolBlock } from "./shared/ToolBlock";
import { clampDetail, isRecord } from "./shared/format";

// ─── Memory tools ─────────────────────────────────────────────────────────────
//
// Three closely-related blocks for the global LLM memory store
// (`server/src/modules/memories/`). All three share the BrainIcon family
// (write/read) so the user can scan a transcript and see "the agent
// touched its persistent memory here". Delete uses TrashIcon for the
// usual destructive-action affordance.
//
// We deliberately don't render the full body for `memory_write` (in case
// the model dumped a long markdown blob) — instead we show the title in
// the detail row and put the body inside the expandable dropdown.

interface MemoryShape {
    id?: string;
    title?: string;
    body?: string;
    updatedAt?: number;
}

interface MemoryWriteInputShape {
    id?: string | null;
    title?: string;
    body?: string;
}

interface MemoryWriteOutputShape {
    ok?: boolean;
    created?: boolean;
    memory?: MemoryShape;
}

interface MemoryReadInputShape {
    id?: string;
}

interface MemoryReadOutputShape {
    ok?: boolean;
    memory?: MemoryShape;
}

interface MemoryDeleteInputShape {
    id?: string;
}

interface MemoryDeleteOutputShape {
    ok?: boolean;
    id?: string;
}

function shortMemoryId(id: string | undefined): string | undefined {
    if (!id) return undefined;
    // Memory ids are UUIDs; show only the first segment so the chip stays
    // readable. Full ids are visible in the expanded body if anyone cares.
    const firstSegment = id.split("-", 1)[0];
    return firstSegment || id.slice(0, 8);
}

export function MemoryWriteBlock({
    invocation
}: {
    invocation: ToolInvocation;
}) {
    const input = isRecord(invocation.input)
        ? (invocation.input as MemoryWriteInputShape)
        : undefined;
    const output = isRecord(invocation.output)
        ? (invocation.output as MemoryWriteOutputShape)
        : undefined;

    // Prefer server-confirmed values over the input echo so the card
    // reflects what actually got persisted (titles get trimmed/normalized
    // on the server).
    const memory = output?.memory;
    const title =
        (typeof memory?.title === "string" && memory.title.length > 0
            ? memory.title
            : undefined) ??
        (typeof input?.title === "string" && input.title.length > 0
            ? input.title
            : undefined);
    const body =
        typeof memory?.body === "string" && memory.body.length > 0
            ? memory.body
            : typeof input?.body === "string"
              ? input.body
              : "";
    const created = output?.created !== false;

    const detail = title ? clampDetail(title) : undefined;

    return (
        <ToolBlock
            icon={<BrainIcon className="size-3.5" weight="bold" />}
            pendingLabel="Saving memory"
            successLabel={created ? "Saved memory" : "Updated memory"}
            errorLabel="Memory save failed"
            deniedLabel="Memory save denied"
            detail={detail}
            error={invocation.error}
            status={invocation.status}
        >
            {invocation.error ? (
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-red-200">
                    {invocation.error}
                </p>
            ) : body.length > 0 ? (
                <div className="px-1 py-0.5 text-[11px] leading-relaxed text-dark-200">
                    {title && (
                        <p className="mb-1 font-medium text-dark-200">
                            {title}
                        </p>
                    )}
                    <p className="whitespace-pre-wrap text-dark-300">{body}</p>
                </div>
            ) : null}
        </ToolBlock>
    );
}

export function MemoryReadBlock({
    invocation
}: {
    invocation: ToolInvocation;
}) {
    const input = isRecord(invocation.input)
        ? (invocation.input as MemoryReadInputShape)
        : undefined;
    const output = isRecord(invocation.output)
        ? (invocation.output as MemoryReadOutputShape)
        : undefined;

    const memory = output?.memory;
    const title =
        typeof memory?.title === "string" && memory.title.length > 0
            ? memory.title
            : undefined;
    const body =
        typeof memory?.body === "string" && memory.body.length > 0
            ? memory.body
            : "";

    // While the call is in-flight (or it failed before producing output)
    // we only have the requested id to show as detail. Once the server
    // returns, we promote the title into the detail row.
    const detail = title
        ? clampDetail(title)
        : shortMemoryId(input?.id ?? memory?.id);

    return (
        <ToolBlock
            icon={<BrainIcon className="size-3.5" weight="bold" />}
            pendingLabel="Recalling memory"
            successLabel="Recalled memory"
            errorLabel="Memory recall failed"
            deniedLabel="Memory recall denied"
            detail={detail}
            error={invocation.error}
            status={invocation.status}
        >
            {invocation.error ? (
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-red-200">
                    {invocation.error}
                </p>
            ) : body.length > 0 ? (
                <div className="px-1 py-0.5 text-[11px] leading-relaxed text-dark-200">
                    {title && (
                        <p className="mb-1 font-medium text-dark-200">
                            {title}
                        </p>
                    )}
                    <p className="whitespace-pre-wrap text-dark-300">{body}</p>
                </div>
            ) : null}
        </ToolBlock>
    );
}

export function MemoryDeleteBlock({
    invocation
}: {
    invocation: ToolInvocation;
}) {
    const input = isRecord(invocation.input)
        ? (invocation.input as MemoryDeleteInputShape)
        : undefined;
    const output = isRecord(invocation.output)
        ? (invocation.output as MemoryDeleteOutputShape)
        : undefined;

    const id = output?.id ?? input?.id;
    const detail = shortMemoryId(id);

    return (
        <ToolBlock
            icon={<TrashIcon className="size-3.5" weight="bold" />}
            pendingLabel="Deleting memory"
            successLabel="Deleted memory"
            errorLabel="Memory delete failed"
            deniedLabel="Memory delete denied"
            detail={detail}
            error={invocation.error}
            status={invocation.status}
        >
            {invocation.error && (
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-red-200">
                    {invocation.error}
                </p>
            )}
        </ToolBlock>
    );
}
