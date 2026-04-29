import { BugIcon } from "@phosphor-icons/react";
import type { ToolInvocation } from "@/features/conversations/conversation-types";
import {
    DiagnosticsInline,
    parseDiagnosticsResult
} from "@/components/chat/DiagnosticsInline";
import { ToolBlock } from "./shared/ToolBlock";
import { isRecord } from "./shared/format";

interface DiagnosticsOutputShape {
    ok?: boolean;
    scope?: "file" | "workspace";
    enabled?: boolean;
    results?: unknown;
    summary?: {
        errors?: number;
        warnings?: number;
        infos?: number;
        hints?: number;
        filesChecked?: number;
    };
}

interface DiagnosticsInputShape {
    path?: string;
    scope?: "file" | "workspace";
    minSeverity?: string;
}

function formatDiagnosticsDetail(
    input: DiagnosticsInputShape | undefined,
    output: DiagnosticsOutputShape | undefined
): string | undefined {
    const scope: "file" | "workspace" =
        output?.scope ?? input?.scope ?? (input?.path ? "file" : "workspace");
    const summary = output?.summary;
    if (!summary) {
        return scope === "workspace" ? "Workspace" : input?.path;
    }
    const errors = summary.errors ?? 0;
    const warnings = summary.warnings ?? 0;
    const filesChecked = summary.filesChecked ?? 0;

    const scopeLabel =
        scope === "workspace"
            ? "Workspace"
            : input?.path
              ? input.path
              : "File";

    const issues: string[] = [];
    if (errors > 0) issues.push(`${errors}E`);
    if (warnings > 0) issues.push(`${warnings}W`);
    const tail =
        issues.length > 0
            ? ` · ${issues.join(" ")}`
            : filesChecked > 0
              ? " · clean"
              : "";
    return `${scopeLabel}${tail}`;
}

export function DiagnosticsBlock({
    invocation
}: {
    invocation: ToolInvocation;
}) {
    const input = isRecord(invocation.input)
        ? (invocation.input as DiagnosticsInputShape)
        : undefined;
    const output = isRecord(invocation.output)
        ? (invocation.output as DiagnosticsOutputShape)
        : undefined;

    const parsed = output ? parseDiagnosticsResult(output) : undefined;
    const enabled = output?.enabled !== false;

    const detail = formatDiagnosticsDetail(input, output);

    return (
        <ToolBlock
            icon={<BugIcon className="size-3.5" weight="bold" />}
            pendingLabel="Checking diagnostics"
            successLabel={
                parsed && parsed.summary.errors + parsed.summary.warnings > 0
                    ? "Diagnostics found issues"
                    : "Diagnostics"
            }
            errorLabel="Diagnostics failed"
            deniedLabel="Diagnostics denied"
            detail={detail}
            error={invocation.error}
            status={invocation.status}
            autoOpen
            autoClose
            bareChildren
        >
            {invocation.error ? (
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-red-200">
                    {invocation.error}
                </p>
            ) : !enabled ? (
                <p className="px-1 py-1 text-[11px] italic text-dark-300">
                    Diagnostics are disabled in settings.
                </p>
            ) : parsed ? (
                <DiagnosticsInline result={parsed} showCleanState />
            ) : (
                <p className="px-1 py-1 text-[11px] italic text-dark-400">
                    Waiting for language server…
                </p>
            )}
        </ToolBlock>
    );
}
