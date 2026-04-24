import { readFile } from "node:fs/promises";
import { logger } from "../../lib/logger";
import {
    LspClient,
    fileUriFromPath,
    languageIdForPath
} from "./lsp.client";
import {
    type Diagnostic,
    type DiagnosticsForFile,
    type DiagnosticSeverity,
    countSeverities,
    filterDiagnostics,
    isTypeScriptPath
} from "./lsp.types";
import { relative } from "node:path";

// ─── TypeScript provider ──────────────────────────────────────────────────────
//
// Wraps an `LspClient` running `typescript-language-server --stdio`. Owns
// per-document versioning and exposes a simple `checkFiles` entry point that
// opens/updates the files on disk, waits for `publishDiagnostics`, and
// returns the filtered results.

interface OpenDoc {
    version: number;
    lastText: string;
}

function resolveTsLangServerEntry(): string {
    // Prefer the ESM cli entry. Bun's require.resolve handles this the same
    // way as Node. Falls back to `import.meta.resolve` via Bun's runtime
    // resolver if for some reason require.resolve is not available.
    try {
        return require.resolve("typescript-language-server/lib/cli.mjs");
    } catch (error) {
        if (typeof (Bun as { resolveSync?: unknown })?.resolveSync === "function") {
            return (Bun as {
                resolveSync: (specifier: string, from: string) => string;
            }).resolveSync(
                "typescript-language-server/lib/cli.mjs",
                process.cwd()
            );
        }
        throw error;
    }
}

export interface TsProviderOptions {
    workspacePath: string;
}

export class TypeScriptLspProvider {
    readonly workspacePath: string;
    private client: LspClient | null = null;
    private initialized: Promise<void> | null = null;
    private readonly openDocs = new Map<string, OpenDoc>();

    constructor(options: TsProviderOptions) {
        this.workspacePath = options.workspacePath;
    }

    /**
     * Lazily start the language server and send `initialize`. Subsequent
     * calls reuse the same running instance.
     */
    private async ensureStarted(): Promise<LspClient> {
        if (this.client && this.client.isAlive) return this.client;
        if (this.initialized) {
            await this.initialized;
            if (this.client && this.client.isAlive) return this.client;
        }

        const entry = resolveTsLangServerEntry();
        logger.log("[lsp:ts] starting", {
            entry,
            workspacePath: this.workspacePath
        });

        const client = new LspClient({
            // Re-use the parent bun runtime so we don't require a separate
            // Node binary on the PATH. Bun can execute plain `.mjs` files.
            command: process.execPath,
            args: [entry, "--stdio"],
            cwd: this.workspacePath,
            label: "ts"
        });
        this.client = client;

        this.initialized = (async () => {
            await client.sendRequest("initialize", {
                processId: process.pid,
                rootUri: fileUriFromPath(this.workspacePath),
                workspaceFolders: [
                    {
                        uri: fileUriFromPath(this.workspacePath),
                        name: "workspace"
                    }
                ],
                capabilities: {
                    textDocument: {
                        publishDiagnostics: {
                            relatedInformation: false,
                            tagSupport: { valueSet: [1, 2] }
                        },
                        synchronization: {
                            didSave: false,
                            willSave: false,
                            willSaveWaitUntil: false,
                            dynamicRegistration: false
                        }
                    },
                    workspace: {
                        workspaceFolders: true,
                        configuration: false,
                        didChangeConfiguration: { dynamicRegistration: false }
                    }
                },
                initializationOptions: {
                    // Keep output minimal and surface useful diagnostic codes.
                    preferences: {
                        includeInlayParameterNameHints: "none",
                        includeCompletionsForModuleExports: false
                    }
                }
            });
            client.sendNotification("initialized", {});
        })();

        try {
            await this.initialized;
        } catch (error) {
            logger.error("[lsp:ts] initialize failed", error);
            this.initialized = null;
            this.client = null;
            try {
                await client.shutdown();
            } catch {
                /* ignore */
            }
            throw error;
        }
        return client;
    }

    /**
     * Open or update a document from disk and return the client. Internal.
     */
    private async syncFromDisk(absolutePath: string): Promise<{
        client: LspClient;
        uri: string;
    } | null> {
        if (!isTypeScriptPath(absolutePath)) return null;
        const client = await this.ensureStarted();
        const uri = fileUriFromPath(absolutePath);

        let text: string;
        try {
            text = await readFile(absolutePath, "utf8");
        } catch (error) {
            logger.log("[lsp:ts] skipping unreadable file", {
                path: absolutePath,
                error: String(error)
            });
            return null;
        }

        const existing = this.openDocs.get(uri);
        if (!existing) {
            client.didOpen({
                uri,
                languageId: languageIdForPath(absolutePath),
                version: 1,
                text
            });
            this.openDocs.set(uri, { version: 1, lastText: text });
        } else if (existing.lastText !== text) {
            const nextVersion = existing.version + 1;
            client.didChange({ uri, version: nextVersion, text });
            this.openDocs.set(uri, { version: nextVersion, lastText: text });
        }
        return { client, uri };
    }

    /**
     * Check a list of files. Reads each file from disk, syncs it with the
     * language server, waits for `publishDiagnostics`, and returns per-file
     * diagnostics filtered by `minSeverity`.
     */
    async checkFiles(
        absolutePaths: readonly string[],
        options: {
            waitMs?: number;
            minSeverity?: DiagnosticSeverity;
            signal?: AbortSignal;
        } = {}
    ): Promise<DiagnosticsForFile[]> {
        const waitMs = options.waitMs ?? 1500;
        const minSeverity: DiagnosticSeverity = options.minSeverity ?? "warning";
        const signal = options.signal;

        const tsPaths = absolutePaths.filter(isTypeScriptPath);
        if (tsPaths.length === 0) return [];

        const client = await this.ensureStarted();

        // Start waiters BEFORE issuing didOpen/didChange so a fast LSP can't
        // publish before we subscribe.
        const waiters: Array<Promise<{
            absolutePath: string;
            uri: string;
            diagnostics: Diagnostic[];
        }>> = [];

        for (const absolutePath of tsPaths) {
            const uri = fileUriFromPath(absolutePath);
            waiters.push(
                client
                    .waitForDiagnostics(uri, { timeoutMs: waitMs, signal })
                    .then((diagnostics) => ({
                        absolutePath,
                        uri,
                        diagnostics
                    }))
                    .catch((error: unknown) => {
                        logger.log("[lsp:ts] waitForDiagnostics error", {
                            uri,
                            error: String(error)
                        });
                        return {
                            absolutePath,
                            uri,
                            diagnostics: client.getDiagnostics(uri) ?? []
                        };
                    })
            );
        }

        for (const absolutePath of tsPaths) {
            await this.syncFromDisk(absolutePath);
        }

        const raw = await Promise.all(waiters);
        return raw.map<DiagnosticsForFile>((entry) => ({
            file: entry.absolutePath,
            relativePath: this.toRelative(entry.absolutePath),
            diagnostics: filterDiagnostics(entry.diagnostics, minSeverity)
        }));
    }

    /**
     * Return diagnostics for every document currently open against this LSP
     * session. Useful as a lightweight "workspace diagnostics" answer — we
     * don't try to enumerate the whole filesystem for v1.
     */
    listOpenDiagnostics(
        minSeverity: DiagnosticSeverity = "warning"
    ): DiagnosticsForFile[] {
        if (!this.client) return [];
        const results: DiagnosticsForFile[] = [];
        for (const uri of this.openDocs.keys()) {
            const absolutePath = uriToPath(uri);
            const diagnostics = this.client.getDiagnostics(uri) ?? [];
            results.push({
                file: absolutePath,
                relativePath: this.toRelative(absolutePath),
                diagnostics: filterDiagnostics(diagnostics, minSeverity)
            });
        }
        return results;
    }

    async dispose(): Promise<void> {
        const client = this.client;
        this.client = null;
        this.initialized = null;
        this.openDocs.clear();
        if (client) {
            try {
                await client.shutdown();
            } catch (error) {
                logger.error("[lsp:ts] shutdown error", error);
            }
        }
    }

    private toRelative(absolutePath: string): string {
        const rel = relative(this.workspacePath, absolutePath);
        return rel.replace(/\\/g, "/");
    }
}

function uriToPath(uri: string): string {
    // Local helper to avoid pulling in the full `pathFromFileUri` just to
    // normalize open-doc URIs back to absolute paths.
    if (!uri.startsWith("file://")) return uri;
    let path = decodeURI(uri.slice("file://".length));
    if (path.startsWith("/") && /^\/[a-zA-Z]:/.test(path)) path = path.slice(1);
    if (process.platform === "win32") path = path.replace(/\//g, "\\");
    return path;
}

export { countSeverities };
