import { logger } from "../../../lib/logger";
import {
    checkFiles as lspCheckFiles,
    shouldAutoRunOnEdits
} from "../../lsp/lsp.service";
import type { DiagnosticsResult } from "../../lsp/lsp.types";
import { isTypeScriptPath } from "../../lsp/lsp.types";

// ─── Post-edit diagnostics helper ─────────────────────────────────────────────
//
// Used by `write` / `str_replace` / `apply_patch` to opportunistically pull
// LSP diagnostics for the files they just edited. Never throws: a dead LSP
// must not break a successful edit.

export async function runPostEditDiagnostics(
    workspacePath: string | undefined,
    absolutePaths: readonly string[]
): Promise<DiagnosticsResult | undefined> {
    if (!workspacePath) return undefined;
    if (!shouldAutoRunOnEdits()) return undefined;
    const tsPaths = absolutePaths.filter(isTypeScriptPath);
    if (tsPaths.length === 0) return undefined;
    try {
        return await lspCheckFiles(workspacePath, tsPaths);
    } catch (error) {
        logger.error("[post-edit-diagnostics] unexpected failure", error);
        return undefined;
    }
}

export function summarizeDiagnosticsForModel(
    result: DiagnosticsResult | undefined
): string {
    if (!result || result.summary.filesChecked === 0) return "";
    const { summary, results } = result;
    if (
        summary.errors === 0 &&
        summary.warnings === 0 &&
        summary.infos === 0 &&
        summary.hints === 0
    ) {
        return "LSP: clean.";
    }
    const parts: string[] = [];
    if (summary.errors > 0) parts.push(`${summary.errors} error${summary.errors === 1 ? "" : "s"}`);
    if (summary.warnings > 0)
        parts.push(`${summary.warnings} warning${summary.warnings === 1 ? "" : "s"}`);
    if (summary.infos > 0)
        parts.push(`${summary.infos} info${summary.infos === 1 ? "" : "s"}`);
    if (summary.hints > 0) parts.push(`${summary.hints} hint${summary.hints === 1 ? "" : "s"}`);
    const lines: string[] = [`LSP: ${parts.join(", ")}.`];
    let emitted = 0;
    const MAX_LINES = 20;
    outer: for (const r of results) {
        if (r.diagnostics.length === 0) continue;
        lines.push(`  ${r.relativePath}`);
        for (const d of r.diagnostics) {
            if (emitted >= MAX_LINES) {
                lines.push("  … (more diagnostics truncated; call `diagnostics` tool to see all)");
                break outer;
            }
            const loc = `${d.range.start.line + 1}:${d.range.start.character + 1}`;
            const code =
                d.code !== undefined && d.code !== null && d.code !== ""
                    ? ` ${d.source ? `${d.source}(${d.code})` : String(d.code)}`
                    : "";
            lines.push(
                `    ${loc} ${d.severity}${code}: ${d.message.split("\n")[0]}`
            );
            emitted++;
        }
    }
    return lines.join("\n");
}
