// ─── LSP diagnostics wire types ───────────────────────────────────────────────
//
// Minimal-surface subset of the LSP spec we care about. Kept wire-compatible
// with `typescript-language-server` (and other LSPs via the same provider
// abstraction later) so the client code can 1:1 pass them through.

export type DiagnosticSeverityNumber = 1 | 2 | 3 | 4;

export const LSP_SEVERITY: Record<DiagnosticSeverityNumber, DiagnosticSeverity> = {
    1: "error",
    2: "warning",
    3: "info",
    4: "hint"
};

export type DiagnosticSeverity = "error" | "warning" | "info" | "hint";

export interface Position {
    line: number;
    character: number;
}

export interface Range {
    start: Position;
    end: Position;
}

/**
 * A single diagnostic reported by a language server. Mirrors the LSP
 * `Diagnostic` shape, trimmed to the fields we surface to the UI and model.
 */
export interface Diagnostic {
    severity: DiagnosticSeverity;
    message: string;
    /** LSP source (e.g. `"ts"`, `"eslint"`). */
    source?: string;
    /** Rule/code for this diagnostic (e.g. TS `2304`, ESLint `no-unused-vars`). */
    code?: string | number;
    range: Range;
}

/**
 * Per-file diagnostics result.
 */
export interface DiagnosticsForFile {
    /** Absolute path on disk, OS-native separators. */
    file: string;
    /** Workspace-relative, forward-slash path. */
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

/**
 * Aggregate diagnostics result, returned by `lspService.checkFiles` /
 * `checkWorkspace` and by the `diagnostics` tool.
 */
export interface DiagnosticsResult {
    results: DiagnosticsForFile[];
    summary: DiagnosticsSummary;
}

const SEVERITY_RANK: Record<DiagnosticSeverity, number> = {
    hint: 1,
    info: 2,
    warning: 3,
    error: 4
};

export function severityAtLeast(
    level: DiagnosticSeverity,
    threshold: DiagnosticSeverity
): boolean {
    return SEVERITY_RANK[level] >= SEVERITY_RANK[threshold];
}

export function filterDiagnostics(
    diagnostics: readonly Diagnostic[],
    minSeverity: DiagnosticSeverity
): Diagnostic[] {
    return diagnostics.filter((d) => severityAtLeast(d.severity, minSeverity));
}

export function countSeverities(
    results: readonly DiagnosticsForFile[]
): DiagnosticsSummary {
    let errors = 0;
    let warnings = 0;
    let infos = 0;
    let hints = 0;
    for (const r of results) {
        for (const d of r.diagnostics) {
            if (d.severity === "error") errors++;
            else if (d.severity === "warning") warnings++;
            else if (d.severity === "info") infos++;
            else hints++;
        }
    }
    return {
        errors,
        warnings,
        infos,
        hints,
        filesChecked: results.length
    };
}

export const TS_EXTENSIONS = [
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".mts",
    ".cts"
] as const;

export function isTypeScriptPath(absolutePath: string): boolean {
    const lower = absolutePath.toLowerCase();
    return TS_EXTENSIONS.some((ext) => lower.endsWith(ext));
}
