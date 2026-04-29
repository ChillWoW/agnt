import { FilesIcon } from "@phosphor-icons/react";
import type { ToolInvocation } from "@/features/conversations/conversation-types";
import { ToolBlock } from "./shared/ToolBlock";
import { clampDetail, isRecord } from "./shared/format";

interface GlobInput {
    pattern?: string;
    path?: string;
    sortBy?: "mtime" | "name";
    headLimit?: number;
    offset?: number;
}

interface GlobOutput {
    matches?: string[];
    matchCount?: number;
    truncated?: boolean;
    sortBy?: "mtime" | "name";
    engine?: "ripgrep" | "walk";
}

function formatGlobDetail(
    input: GlobInput | undefined,
    output: GlobOutput | undefined
): string | undefined {
    const pattern =
        typeof input?.pattern === "string" && input.pattern.length > 0
            ? input.pattern
            : undefined;
    const count =
        typeof output?.matchCount === "number"
            ? output.matchCount
            : Array.isArray(output?.matches)
              ? output.matches.length
              : undefined;

    if (pattern && typeof count === "number") {
        const suffix = output?.truncated ? "+" : "";
        return `${clampDetail(pattern)} · ${count}${suffix}`;
    }
    return pattern ? clampDetail(pattern) : pattern;
}

export function GlobBlock({ invocation }: { invocation: ToolInvocation }) {
    const input = isRecord(invocation.input)
        ? (invocation.input as GlobInput)
        : undefined;
    const output = isRecord(invocation.output)
        ? (invocation.output as GlobOutput)
        : undefined;
    const matches = Array.isArray(output?.matches) ? output.matches : [];

    return (
        <ToolBlock
            icon={<FilesIcon className="size-3.5" weight="bold" />}
            pendingLabel="Finding files"
            successLabel="Found"
            errorLabel="Glob failed"
            deniedLabel="Glob denied"
            detail={formatGlobDetail(input, output)}
            error={invocation.error}
            status={invocation.status}
        >
            {invocation.error ? (
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-red-200">
                    {invocation.error}
                </p>
            ) : matches.length > 0 ? (
                <ul className="flex flex-col text-[11px] text-dark-200">
                    {matches.map((match, idx) => (
                        <li key={`${match}-${idx}`} className="truncate">
                            {match}
                        </li>
                    ))}
                    {output?.truncated && (
                        <li className="text-dark-300">
                            ... more results truncated
                        </li>
                    )}
                </ul>
            ) : null}
        </ToolBlock>
    );
}
