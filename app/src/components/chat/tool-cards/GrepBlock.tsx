import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import type { ToolInvocation } from "@/features/conversations/conversation-types";
import { ToolBlock } from "./shared/ToolBlock";
import { clampDetail, isRecord } from "./shared/format";

interface GrepInput {
    pattern?: string;
    include?: string;
    path?: string;
    type?: string;
    typeNot?: string;
    outputMode?: "content" | "files_with_matches" | "count";
    multiline?: boolean;
    context?: number;
    contextBefore?: number;
    contextAfter?: number;
}

interface GrepMatch {
    file?: string;
    line?: number;
    text?: string;
    isContext?: boolean;
}

interface GrepFileCount {
    file?: string;
    count?: number;
}

interface GrepOutput {
    outputMode?: "content" | "files_with_matches" | "count";
    matches?: GrepMatch[];
    files?: string[];
    counts?: GrepFileCount[];
    matchCount?: number;
    filesMatched?: number;
    truncated?: boolean;
}

function formatGrepDetail(
    input: GrepInput | undefined,
    output: GrepOutput | undefined
): string | undefined {
    const pattern =
        typeof input?.pattern === "string" && input.pattern.length > 0
            ? input.pattern
            : undefined;
    const mode = output?.outputMode ?? input?.outputMode ?? "content";
    const count =
        typeof output?.matchCount === "number"
            ? output.matchCount
            : Array.isArray(output?.matches)
              ? output.matches.length
              : Array.isArray(output?.files)
                ? output.files.length
                : Array.isArray(output?.counts)
                  ? output.counts.length
                  : undefined;
    const files = output?.filesMatched;

    if (pattern && typeof count === "number") {
        const suffix = output?.truncated ? "+" : "";
        const tail =
            mode === "files_with_matches"
                ? ` file${count === 1 ? "" : "s"}`
                : mode === "count"
                  ? ` match${count === 1 ? "" : "es"}`
                  : typeof files === "number" && files > 0
                    ? ` in ${files} files`
                    : "";
        return `${clampDetail(pattern)} · ${count}${suffix}${tail}`;
    }
    return pattern ? clampDetail(pattern) : pattern;
}

export function GrepBlock({ invocation }: { invocation: ToolInvocation }) {
    const input = isRecord(invocation.input)
        ? (invocation.input as GrepInput)
        : undefined;
    const output = isRecord(invocation.output)
        ? (invocation.output as GrepOutput)
        : undefined;
    const mode = output?.outputMode ?? "content";
    const matches = Array.isArray(output?.matches) ? output.matches : [];
    const files = Array.isArray(output?.files) ? output.files : [];
    const counts = Array.isArray(output?.counts) ? output.counts : [];

    return (
        <ToolBlock
            icon={<MagnifyingGlassIcon className="size-3.5" weight="bold" />}
            pendingLabel="Searching"
            successLabel="Searched"
            errorLabel="Grep failed"
            deniedLabel="Grep denied"
            detail={formatGrepDetail(input, output)}
            error={invocation.error}
            status={invocation.status}
        >
            {invocation.error ? (
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-red-200">
                    {invocation.error}
                </p>
            ) : mode === "files_with_matches" && files.length > 0 ? (
                <ul className="flex flex-col text-[11px] text-dark-200">
                    {files.map((file, idx) => (
                        <li key={`${file}-${idx}`} className="truncate">
                            {file}
                        </li>
                    ))}
                    {output?.truncated && (
                        <li className="text-dark-300">
                            ... more files truncated
                        </li>
                    )}
                </ul>
            ) : mode === "count" && counts.length > 0 ? (
                <ul className="flex flex-col text-[11px] text-dark-200">
                    {counts.map((row, idx) => (
                        <li
                            key={`${row.file ?? ""}-${idx}`}
                            className="truncate"
                        >
                            <span className="text-dark-300">
                                {row.count ?? 0}×
                            </span>{" "}
                            <span>{row.file ?? "?"}</span>
                        </li>
                    ))}
                    {output?.truncated && (
                        <li className="text-dark-300">
                            ... more files truncated
                        </li>
                    )}
                </ul>
            ) : matches.length > 0 ? (
                <ul className="flex flex-col text-[11px] text-dark-200">
                    {matches.map((match, idx) => (
                        <li
                            key={`${match.file ?? ""}-${match.line ?? 0}-${idx}`}
                            className={
                                match.isContext
                                    ? "truncate text-dark-300"
                                    : "truncate"
                            }
                        >
                            <span
                                className={
                                    match.isContext
                                        ? "text-dark-300"
                                        : "text-dark-200"
                                }
                            >
                                {match.file ?? "?"}:{match.line ?? "?"}
                            </span>
                            {match.text ? (
                                <>
                                    <span className="text-dark-300">
                                        {match.isContext ? "- " : ": "}
                                    </span>
                                    <span>{match.text}</span>
                                </>
                            ) : null}
                        </li>
                    ))}
                    {output?.truncated && (
                        <li className="text-dark-300">
                            ... more matches truncated
                        </li>
                    )}
                </ul>
            ) : null}
        </ToolBlock>
    );
}
