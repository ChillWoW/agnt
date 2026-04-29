import { WrenchIcon } from "@phosphor-icons/react";
import type { ToolInvocation } from "@/features/conversations/conversation-types";
import { ToolBlock } from "./shared/ToolBlock";

// ─── Compaction-trim sentinel ─────────────────────────────────────────────────
// When `compactConversation` rewrites an oversized tool_invocations.output_json
// to a sentinel object (see `server/src/modules/conversations/compact.service.ts`
// → `buildTrimmedOutputSentinel`), we detect it here and render a generic
// "Output trimmed during compaction" pill instead of letting the tool-specific
// block crash on a payload that doesn't match its expected schema.

const COMPACT_TRIMMED_OUTPUT_FLAG = "__agnt_compact_trimmed";

export interface CompactTrimmedOutput {
    [COMPACT_TRIMMED_OUTPUT_FLAG]: true;
    originalChars: number;
    toolName: string;
    trimmedAt: string;
    placeholder: string;
}

export function isCompactTrimmedOutput(
    value: unknown
): value is CompactTrimmedOutput {
    return (
        typeof value === "object" &&
        value !== null &&
        (value as Record<string, unknown>)[COMPACT_TRIMMED_OUTPUT_FLAG] === true
    );
}

export function CompactionTrimmedBlock({
    invocation,
    output
}: {
    invocation: ToolInvocation;
    output: CompactTrimmedOutput;
}) {
    const detail = `${output.toolName} · output trimmed (${output.originalChars.toLocaleString()} chars freed)`;
    return (
        <ToolBlock
            icon={<WrenchIcon size={14} weight="duotone" />}
            pendingLabel={detail}
            successLabel={detail}
            errorLabel={detail}
            status={invocation.status}
            error={invocation.error}
            detail="Trimmed during context compaction"
        >
            <div className="px-3 py-2 text-xs text-zinc-500 dark:text-zinc-400">
                {output.placeholder}
            </div>
        </ToolBlock>
    );
}
