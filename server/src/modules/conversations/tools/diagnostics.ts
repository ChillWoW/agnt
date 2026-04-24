import { z } from "zod";
import { logger } from "../../../lib/logger";
import type { ToolDefinition, ToolModelOutput } from "./types";
import { resolveWorkspacePath, toPosix } from "./workspace-path";
import {
    checkFiles as lspCheckFiles,
    checkWorkspace as lspCheckWorkspace,
    isDiagnosticsEnabled
} from "../../lsp/lsp.service";
import type {
    Diagnostic,
    DiagnosticSeverity,
    DiagnosticsForFile,
    DiagnosticsResult
} from "../../lsp/lsp.types";
import { isTypeScriptPath } from "../../lsp/lsp.types";

// ─── Schema ───────────────────────────────────────────────────────────────────

export const diagnosticsScopeSchema = z.enum(["file", "workspace"]);

export const diagnosticsInputSchema = z.object({
    path: z
        .string()
        .optional()
        .describe(
            'Optional path to a single file to check. Accepts: (1) workspace-root-relative paths starting with "/" or "\\", (2) workspace-relative paths (e.g. "src/index.ts"), or (3) absolute paths inside the workspace. Omit to check every file the language server is currently aware of.'
        ),
    scope: diagnosticsScopeSchema
        .optional()
        .describe(
            'Defaults to "file" when `path` is set, otherwise "workspace". Use "workspace" to get diagnostics for every file the language server currently has open.'
        ),
    minSeverity: z
        .enum(["error", "warning", "info", "hint"])
        .optional()
        .describe(
            'Filter out diagnostics below this severity. Defaults to the value from the `diagnostics` settings category (usually "warning"). Use "error" to see only errors, "hint" to see everything.'
        )
});

export type DiagnosticsInput = z.infer<typeof diagnosticsInputSchema>;

// ─── Output shape ─────────────────────────────────────────────────────────────

export interface DiagnosticsToolOutput {
    ok: true;
    scope: "file" | "workspace";
    enabled: boolean;
    results: DiagnosticsForFile[];
    summary: DiagnosticsResult["summary"];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatLocation(d: Diagnostic): string {
    const line = d.range.start.line + 1;
    const col = d.range.start.character + 1;
    return `${line}:${col}`;
}

function codeLabel(d: Diagnostic): string {
    if (d.code === undefined || d.code === null || d.code === "") return "";
    if (d.source && d.source.length > 0) return `${d.source}(${d.code})`;
    return String(d.code);
}

function emptyResult(scope: "file" | "workspace", enabled: boolean): DiagnosticsToolOutput {
    return {
        ok: true,
        scope,
        enabled,
        results: [],
        summary: {
            errors: 0,
            warnings: 0,
            infos: 0,
            hints: 0,
            filesChecked: 0
        }
    };
}

// ─── Execute ──────────────────────────────────────────────────────────────────

function makeExecuteDiagnostics(workspacePath?: string) {
    return async function executeDiagnostics(
        input: DiagnosticsInput,
        ctx?: { abortSignal?: AbortSignal }
    ): Promise<DiagnosticsToolOutput> {
        const enabled = isDiagnosticsEnabled();
        const minSeverity = input.minSeverity as DiagnosticSeverity | undefined;

        const scope: "file" | "workspace" =
            input.scope ?? (input.path ? "file" : "workspace");

        if (!enabled) {
            return emptyResult(scope, false);
        }

        if (!workspacePath) {
            throw new Error(
                'Tool "diagnostics" requires an open workspace. Open a workspace folder and try again.'
            );
        }

        if (scope === "file") {
            if (!input.path || input.path.trim().length === 0) {
                throw new Error(
                    'diagnostics: `path` is required when `scope` is "file".'
                );
            }
            const { absolute } = resolveWorkspacePath(
                input.path,
                workspacePath,
                "diagnostics"
            );
            if (!isTypeScriptPath(absolute)) {
                // Not a TS/JS file — return a clean empty result rather than
                // erroring, so callers can iterate through a mixed list of
                // changed files without special-casing.
                logger.log("[tool:diagnostics] skip non-ts file", { absolute });
                return emptyResult("file", true);
            }
            const result = await lspCheckFiles(workspacePath, [absolute], {
                minSeverity,
                signal: ctx?.abortSignal
            });
            return {
                ok: true,
                scope: "file",
                enabled: true,
                results: result.results,
                summary: result.summary
            };
        }

        const result = await lspCheckWorkspace(workspacePath, { minSeverity });
        return {
            ok: true,
            scope: "workspace",
            enabled: true,
            results: result.results,
            summary: result.summary
        };
    };
}

// ─── Model output (compact text summary) ─────────────────────────────────────

const MAX_DIAG_LINES = 40;

function toDiagnosticsModelOutput({
    output
}: {
    input: DiagnosticsInput;
    output: DiagnosticsToolOutput;
}): ToolModelOutput {
    if (!output.enabled) {
        return {
            type: "text",
            value:
                "LSP diagnostics are disabled in settings. Enable them in Settings → Diagnostics to get automatic error reports."
        };
    }
    const { results, summary, scope } = output;
    if (summary.filesChecked === 0 && results.length === 0) {
        return {
            type: "text",
            value:
                scope === "workspace"
                    ? "LSP: no TypeScript files currently tracked. Edit or open a .ts/.tsx file to populate diagnostics."
                    : "LSP: no diagnostics available (not a TS/JS file, or the language server has nothing to check)."
        };
    }
    const header = buildSummaryHeader(summary, scope);
    if (summary.errors === 0 && summary.warnings === 0 && summary.infos === 0 && summary.hints === 0) {
        return { type: "text", value: `${header} (clean).` };
    }
    const lines: string[] = [header];
    let emitted = 0;
    outer: for (const fileResult of results) {
        if (fileResult.diagnostics.length === 0) continue;
        lines.push(`  ${fileResult.relativePath}`);
        for (const d of fileResult.diagnostics) {
            if (emitted >= MAX_DIAG_LINES) {
                lines.push(`  … (more diagnostics truncated)`);
                break outer;
            }
            const code = codeLabel(d);
            const codePart = code ? ` ${code}` : "";
            lines.push(
                `    ${formatLocation(d)} ${d.severity}${codePart}: ${d.message.split("\n")[0]}`
            );
            emitted++;
        }
    }
    return { type: "text", value: lines.join("\n") };
}

function buildSummaryHeader(
    summary: DiagnosticsResult["summary"],
    scope: "file" | "workspace"
): string {
    const parts: string[] = [];
    if (summary.errors > 0) parts.push(`${summary.errors} error${summary.errors === 1 ? "" : "s"}`);
    if (summary.warnings > 0)
        parts.push(`${summary.warnings} warning${summary.warnings === 1 ? "" : "s"}`);
    if (summary.infos > 0)
        parts.push(`${summary.infos} info${summary.infos === 1 ? "" : "s"}`);
    if (summary.hints > 0) parts.push(`${summary.hints} hint${summary.hints === 1 ? "" : "s"}`);
    const body = parts.length > 0 ? parts.join(", ") : "no issues";
    const where = scope === "workspace" ? "across open files" : "in file";
    return `LSP: ${body} ${where} (${summary.filesChecked} file${summary.filesChecked === 1 ? "" : "s"} checked).`;
}

// ─── Description ──────────────────────────────────────────────────────────────

const TOOL_DESCRIPTION =
    "Run LSP diagnostics (TypeScript / JavaScript) against a single file or the whole workspace. Returns errors, warnings, infos, and hints collected from the language server. " +
    "Use this after fixing a reported error to verify the fix, or when investigating unexpected type-checker output. " +
    "`write` / `str_replace` / `apply_patch` already auto-run diagnostics on the files they edit — call this tool explicitly when you need to re-check after a build step, check a file you didn't just edit, or sweep the whole workspace. " +
    "Non-TS/JS files are silently ignored (returned as 'no diagnostics').";

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createDiagnosticsToolDef(
    workspacePath?: string
): ToolDefinition<DiagnosticsInput, DiagnosticsToolOutput> {
    return {
        name: "diagnostics",
        description: TOOL_DESCRIPTION,
        inputSchema: diagnosticsInputSchema,
        execute: makeExecuteDiagnostics(workspacePath),
        toModelOutput: toDiagnosticsModelOutput
    };
}

export const diagnosticsToolDef = createDiagnosticsToolDef();

export { toPosix };
