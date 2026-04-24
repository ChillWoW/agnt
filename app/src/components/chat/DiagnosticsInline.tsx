import { useState } from "react";
import {
    CaretRightIcon,
    CheckCircleIcon,
    WarningCircleIcon,
    WarningIcon,
    InfoIcon,
    LightbulbIcon
} from "@phosphor-icons/react";
import { cn } from "@/lib/cn";

// ─── Types (mirror server/src/modules/lsp/lsp.types.ts) ──────────────────────

export type DiagnosticSeverity = "error" | "warning" | "info" | "hint";

export interface DiagnosticPosition {
    line: number;
    character: number;
}

export interface DiagnosticRange {
    start: DiagnosticPosition;
    end: DiagnosticPosition;
}

export interface Diagnostic {
    severity: DiagnosticSeverity;
    message: string;
    source?: string;
    code?: string | number;
    range: DiagnosticRange;
}

export interface DiagnosticsForFile {
    file: string;
    relativePath: string;
    diagnostics: Diagnostic[];
}

export interface DiagnosticsSummary {
    errors: number;
    warnings: number;
    infos: number;
    hints: number;
    filesChecked: number;
}

export interface DiagnosticsResult {
    results: DiagnosticsForFile[];
    summary: DiagnosticsSummary;
}

// ─── Shape guards ────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseDiagnosticsResult(
    value: unknown
): DiagnosticsResult | undefined {
    if (!isRecord(value)) return undefined;
    const resultsRaw = value.results;
    const summaryRaw = value.summary;
    if (!Array.isArray(resultsRaw) || !isRecord(summaryRaw)) return undefined;
    const results: DiagnosticsForFile[] = [];
    for (const entry of resultsRaw) {
        if (!isRecord(entry)) continue;
        const diagsRaw = entry.diagnostics;
        if (!Array.isArray(diagsRaw)) continue;
        const diagnostics: Diagnostic[] = [];
        for (const d of diagsRaw) {
            if (!isRecord(d)) continue;
            const severity = d.severity;
            if (
                severity !== "error" &&
                severity !== "warning" &&
                severity !== "info" &&
                severity !== "hint"
            ) {
                continue;
            }
            const range = d.range;
            if (!isRecord(range) || !isRecord(range.start) || !isRecord(range.end))
                continue;
            diagnostics.push({
                severity,
                message: typeof d.message === "string" ? d.message : "",
                source: typeof d.source === "string" ? d.source : undefined,
                code:
                    typeof d.code === "string" || typeof d.code === "number"
                        ? d.code
                        : undefined,
                range: {
                    start: {
                        line:
                            typeof range.start.line === "number"
                                ? range.start.line
                                : 0,
                        character:
                            typeof range.start.character === "number"
                                ? range.start.character
                                : 0
                    },
                    end: {
                        line:
                            typeof range.end.line === "number"
                                ? range.end.line
                                : 0,
                        character:
                            typeof range.end.character === "number"
                                ? range.end.character
                                : 0
                    }
                }
            });
        }
        results.push({
            file: typeof entry.file === "string" ? entry.file : "",
            relativePath:
                typeof entry.relativePath === "string"
                    ? entry.relativePath
                    : typeof entry.file === "string"
                      ? entry.file
                      : "",
            diagnostics
        });
    }
    return {
        results,
        summary: {
            errors:
                typeof summaryRaw.errors === "number" ? summaryRaw.errors : 0,
            warnings:
                typeof summaryRaw.warnings === "number"
                    ? summaryRaw.warnings
                    : 0,
            infos: typeof summaryRaw.infos === "number" ? summaryRaw.infos : 0,
            hints: typeof summaryRaw.hints === "number" ? summaryRaw.hints : 0,
            filesChecked:
                typeof summaryRaw.filesChecked === "number"
                    ? summaryRaw.filesChecked
                    : 0
        }
    };
}

// ─── Presentation ────────────────────────────────────────────────────────────

function severityIcon(severity: DiagnosticSeverity) {
    switch (severity) {
        case "error":
            return <WarningCircleIcon className="size-3" weight="fill" />;
        case "warning":
            return <WarningIcon className="size-3" weight="fill" />;
        case "info":
            return <InfoIcon className="size-3" weight="fill" />;
        case "hint":
            return <LightbulbIcon className="size-3" weight="fill" />;
    }
}

function severityColor(severity: DiagnosticSeverity): string {
    switch (severity) {
        case "error":
            return "text-red-400";
        case "warning":
            return "text-amber-400";
        case "info":
            return "text-sky-400";
        case "hint":
            return "text-dark-300";
    }
}

function countsForFile(diagnostics: Diagnostic[]): {
    errors: number;
    warnings: number;
    infos: number;
    hints: number;
} {
    let errors = 0;
    let warnings = 0;
    let infos = 0;
    let hints = 0;
    for (const d of diagnostics) {
        if (d.severity === "error") errors++;
        else if (d.severity === "warning") warnings++;
        else if (d.severity === "info") infos++;
        else hints++;
    }
    return { errors, warnings, infos, hints };
}

// ─── Component ───────────────────────────────────────────────────────────────

export interface DiagnosticsInlineProps {
    result: DiagnosticsResult;
    /** When true, the "LSP clean" pill is rendered even if no files have issues. */
    showCleanState?: boolean;
    className?: string;
}

export function DiagnosticsInline({
    result,
    showCleanState = true,
    className
}: DiagnosticsInlineProps) {
    const { results, summary } = result;
    const totalIssues =
        summary.errors + summary.warnings + summary.infos + summary.hints;

    if (summary.filesChecked === 0 && totalIssues === 0) {
        // LSP didn't actually run (e.g. non-TS file). Render nothing so the
        // diff panel stays tidy.
        return null;
    }

    if (totalIssues === 0) {
        if (!showCleanState) return null;
        return (
            <div
                className={cn(
                    "flex items-center gap-1.5 px-1 pt-1.5 text-[11px] text-emerald-400",
                    className
                )}
            >
                <CheckCircleIcon className="size-3" weight="fill" />
                <span>LSP clean</span>
                <span className="text-dark-400 normal-case">
                    ({summary.filesChecked} file
                    {summary.filesChecked === 1 ? "" : "s"} checked)
                </span>
            </div>
        );
    }

    return (
        <div className={cn("flex flex-col gap-1 pt-1.5", className)}>
            {results.map((fileResult, idx) =>
                fileResult.diagnostics.length === 0 ? null : (
                    <DiagnosticsFileRow
                        key={`${fileResult.relativePath || fileResult.file}-${idx}`}
                        fileResult={fileResult}
                    />
                )
            )}
        </div>
    );
}

function DiagnosticsFileRow({ fileResult }: { fileResult: DiagnosticsForFile }) {
    const counts = countsForFile(fileResult.diagnostics);
    const [expanded, setExpanded] = useState(
        counts.errors > 0 // auto-expand files that have errors
    );

    return (
        <div className="rounded border border-dark-700 bg-dark-900/60">
            <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-[11px] text-dark-200 hover:text-dark-50"
            >
                <CaretRightIcon
                    className={cn(
                        "size-3 transition-transform",
                        expanded ? "rotate-90" : "rotate-0"
                    )}
                    weight="bold"
                />
                <span className="font-mono truncate">
                    {fileResult.relativePath || fileResult.file}
                </span>
                <div className="ml-auto flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide">
                    {counts.errors > 0 && (
                        <SeverityPill severity="error" count={counts.errors} />
                    )}
                    {counts.warnings > 0 && (
                        <SeverityPill
                            severity="warning"
                            count={counts.warnings}
                        />
                    )}
                    {counts.infos > 0 && (
                        <SeverityPill severity="info" count={counts.infos} />
                    )}
                    {counts.hints > 0 && (
                        <SeverityPill severity="hint" count={counts.hints} />
                    )}
                </div>
            </button>
            {expanded && (
                <ul className="flex flex-col gap-0.5 border-t border-dark-800 px-2 py-1.5">
                    {fileResult.diagnostics.map((d, idx) => (
                        <DiagnosticListItem key={idx} diagnostic={d} />
                    ))}
                </ul>
            )}
        </div>
    );
}

function SeverityPill({
    severity,
    count
}: {
    severity: DiagnosticSeverity;
    count: number;
}) {
    const letter =
        severity === "error"
            ? "E"
            : severity === "warning"
              ? "W"
              : severity === "info"
                ? "I"
                : "H";
    return (
        <span
            className={cn(
                "inline-flex items-center gap-0.5 rounded px-1 py-0.5",
                severity === "error" && "bg-red-500/15 text-red-300",
                severity === "warning" && "bg-amber-500/15 text-amber-300",
                severity === "info" && "bg-sky-500/15 text-sky-300",
                severity === "hint" && "bg-dark-800 text-dark-200"
            )}
        >
            {count}
            {letter}
        </span>
    );
}

function DiagnosticListItem({ diagnostic }: { diagnostic: Diagnostic }) {
    const line = diagnostic.range.start.line + 1;
    const col = diagnostic.range.start.character + 1;
    const code =
        diagnostic.code !== undefined && diagnostic.code !== null
            ? String(diagnostic.code)
            : "";
    const source = diagnostic.source;
    const codeLabel = code
        ? source
            ? `${source}(${code})`
            : code
        : source ?? "";

    return (
        <li className="flex items-start gap-1.5 text-[11px] leading-relaxed">
            <span
                className={cn(
                    "mt-0.5 shrink-0",
                    severityColor(diagnostic.severity)
                )}
            >
                {severityIcon(diagnostic.severity)}
            </span>
            <span className="shrink-0 font-mono text-dark-400 tabular-nums">
                {line}:{col}
            </span>
            {codeLabel && (
                <span className="shrink-0 rounded bg-dark-800 px-1 font-mono text-[10px] text-dark-200">
                    {codeLabel}
                </span>
            )}
            <span className="text-dark-100">{diagnostic.message}</span>
        </li>
    );
}
