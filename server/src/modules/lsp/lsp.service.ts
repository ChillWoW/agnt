import { logger } from "../../lib/logger";
import { getCategory } from "../settings/settings.service";
import {
    countSeverities,
    isTypeScriptPath,
    type DiagnosticsForFile,
    type DiagnosticsResult,
    type DiagnosticSeverity
} from "./lsp.types";
import {
    disposeAll as registryDisposeAll,
    disposeWorkspace as registryDisposeWorkspace,
    getTypeScriptProvider
} from "./lsp.registry";

// ─── Public LSP service ───────────────────────────────────────────────────────
//
// Thin facade over the provider registry. Tool code only ever touches this
// module — it centralizes settings lookup, error isolation (a dead LSP must
// never break an edit tool), and the `DiagnosticsResult` shape.

export interface CheckFilesOptions {
    waitMs?: number;
    minSeverity?: DiagnosticSeverity;
    signal?: AbortSignal;
}

export interface CheckOptions {
    minSeverity?: DiagnosticSeverity;
}

function readSettings(): {
    enabled: boolean;
    autoRunOnEdits: boolean;
    minSeverity: DiagnosticSeverity;
    waitMs: number;
} {
    try {
        const settings = getCategory("diagnostics");
        return {
            enabled: settings.enabled,
            autoRunOnEdits: settings.autoRunOnEdits,
            minSeverity: settings.minSeverity,
            waitMs: settings.waitMs
        };
    } catch (error) {
        logger.error("[lsp:service] failed to load settings", error);
        return {
            enabled: true,
            autoRunOnEdits: true,
            minSeverity: "warning",
            waitMs: 1500
        };
    }
}

/**
 * True when diagnostics are enabled globally (regardless of auto-run).
 */
export function isDiagnosticsEnabled(): boolean {
    return readSettings().enabled;
}

/**
 * True when edit tools should auto-run diagnostics post-mutation.
 */
export function shouldAutoRunOnEdits(): boolean {
    const s = readSettings();
    return s.enabled && s.autoRunOnEdits;
}

/**
 * Check a specific list of absolute file paths. Non-TS files are silently
 * dropped. Returns an empty result (summary with zero counts) if diagnostics
 * are disabled or no TS files remain after filtering.
 */
export async function checkFiles(
    workspacePath: string,
    absolutePaths: readonly string[],
    options: CheckFilesOptions = {}
): Promise<DiagnosticsResult> {
    const settings = readSettings();
    if (!settings.enabled) {
        return emptyResult();
    }

    const tsPaths = absolutePaths.filter(isTypeScriptPath);
    if (tsPaths.length === 0) {
        return emptyResult();
    }

    let results: DiagnosticsForFile[] = [];
    try {
        const provider = getTypeScriptProvider(workspacePath);
        results = await provider.checkFiles(tsPaths, {
            waitMs: options.waitMs ?? settings.waitMs,
            minSeverity: options.minSeverity ?? settings.minSeverity,
            signal: options.signal
        });
    } catch (error) {
        logger.error("[lsp:service] checkFiles failed", {
            workspacePath,
            error: String(error)
        });
        return emptyResult();
    }

    return {
        results,
        summary: countSeverities(results)
    };
}

/**
 * Return diagnostics for every document currently open in the workspace's
 * LSP session. v1 doesn't enumerate the whole filesystem — callers get
 * "what the LSP is already aware of" which covers everything the model has
 * recently touched through the edit tools plus everything transitively
 * pulled in by their imports.
 */
export async function checkWorkspace(
    workspacePath: string,
    options: CheckOptions = {}
): Promise<DiagnosticsResult> {
    const settings = readSettings();
    if (!settings.enabled) return emptyResult();

    let results: DiagnosticsForFile[] = [];
    try {
        const provider = getTypeScriptProvider(workspacePath);
        results = provider.listOpenDiagnostics(
            options.minSeverity ?? settings.minSeverity
        );
    } catch (error) {
        logger.error("[lsp:service] checkWorkspace failed", {
            workspacePath,
            error: String(error)
        });
        return emptyResult();
    }
    return {
        results,
        summary: countSeverities(results)
    };
}

export async function disposeWorkspace(workspacePath: string): Promise<void> {
    await registryDisposeWorkspace(workspacePath);
}

export async function disposeAll(): Promise<void> {
    await registryDisposeAll();
}

function emptyResult(): DiagnosticsResult {
    return {
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
