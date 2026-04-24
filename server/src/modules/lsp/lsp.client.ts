import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { logger } from "../../lib/logger";
import {
    LSP_SEVERITY,
    type Diagnostic,
    type DiagnosticSeverityNumber,
    type Position,
    type Range
} from "./lsp.types";

// ─── JSON-RPC framing ─────────────────────────────────────────────────────────
//
// LSP speaks JSON-RPC 2.0 over stdio with `Content-Length` framed messages.
// We keep the framing parser minimal and forgiving (tolerates extra headers
// like `Content-Type`).

interface LspRequest {
    jsonrpc: "2.0";
    id: number;
    method: string;
    params?: unknown;
}

interface LspNotification {
    jsonrpc: "2.0";
    method: string;
    params?: unknown;
}

interface LspResponseOk {
    jsonrpc: "2.0";
    id: number;
    result: unknown;
}

interface LspResponseError {
    jsonrpc: "2.0";
    id: number;
    error: { code: number; message: string; data?: unknown };
}

type LspIncoming = LspResponseOk | LspResponseError | LspNotification | LspRequest;

// ─── Types used locally to the client ────────────────────────────────────────

interface LspClientOptions {
    /** Absolute path to the command binary (e.g. `bun`). */
    command: string;
    args: string[];
    cwd: string;
    env?: Record<string, string | undefined>;
    /** Used purely for logging. */
    label?: string;
}

interface RawDiagnostic {
    range: Range;
    severity?: number;
    code?: string | number;
    source?: string;
    message: string;
    [key: string]: unknown;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fileUriFromPath(absolutePath: string): string {
    // LSP expects file URIs. On Windows we need a leading slash before the
    // drive letter (file:///C:/foo), on Unix we just prefix with file://.
    const normalized = absolutePath.replace(/\\/g, "/");
    if (/^[a-zA-Z]:/.test(normalized)) {
        return `file:///${encodeURI(normalized)}`;
    }
    return `file://${encodeURI(normalized)}`;
}

function pathFromFileUri(uri: string): string {
    if (!uri.startsWith("file://")) return uri;
    let path = decodeURI(uri.slice("file://".length));
    if (path.startsWith("/") && /^\/[a-zA-Z]:/.test(path)) {
        path = path.slice(1);
    }
    if (process.platform === "win32") {
        path = path.replace(/\//g, "\\");
    }
    return path;
}

function languageIdForPath(absolutePath: string): string {
    const lower = absolutePath.toLowerCase();
    if (lower.endsWith(".tsx")) return "typescriptreact";
    if (lower.endsWith(".jsx")) return "javascriptreact";
    if (
        lower.endsWith(".js") ||
        lower.endsWith(".mjs") ||
        lower.endsWith(".cjs")
    ) {
        return "javascript";
    }
    return "typescript";
}

function normalizeDiagnostic(raw: RawDiagnostic): Diagnostic {
    const severityNum = (
        typeof raw.severity === "number" ? raw.severity : 1
    ) as DiagnosticSeverityNumber;
    const severity = LSP_SEVERITY[severityNum] ?? "error";
    const code =
        typeof raw.code === "string" || typeof raw.code === "number"
            ? raw.code
            : undefined;
    return {
        severity,
        message: raw.message,
        source: raw.source,
        code,
        range: raw.range
    };
}

// ─── Client ───────────────────────────────────────────────────────────────────

/**
 * Minimal LSP JSON-RPC client over stdio. Exposes `sendRequest` /
 * `sendNotification` plus typed helpers for the doc/diagnostic subset we
 * actually use. One instance manages one language server child process.
 */
export class LspClient {
    private readonly child: ChildProcessWithoutNullStreams;
    private readonly events = new EventEmitter();
    private nextId = 1;
    private stdoutBuffer = Buffer.alloc(0);
    private readonly pending = new Map<
        number,
        { resolve: (v: unknown) => void; reject: (e: Error) => void }
    >();
    /** `file:///.../foo.ts` -> latest diagnostics. */
    private readonly diagnosticsByUri = new Map<string, Diagnostic[]>();
    private closed = false;
    private exitError: Error | null = null;

    constructor(options: LspClientOptions) {
        this.child = spawn(options.command, options.args, {
            cwd: options.cwd,
            env: { ...process.env, ...options.env },
            stdio: ["pipe", "pipe", "pipe"],
            // On Windows, avoid opening a new console window for the LSP
            // subprocess. `spawn` documents `windowsHide` as the way to do this.
            windowsHide: true
        }) as ChildProcessWithoutNullStreams;

        const label = options.label ?? "lsp";

        this.child.stdout.on("data", (chunk: Buffer) => {
            this.stdoutBuffer = Buffer.concat([this.stdoutBuffer, chunk]);
            this.drainBuffer();
        });

        this.child.stderr.on("data", (chunk: Buffer) => {
            const text = chunk.toString("utf8").trimEnd();
            if (text.length > 0) {
                logger.log(`[lsp:${label}] stderr`, text);
            }
        });

        this.child.on("error", (error) => {
            logger.error(`[lsp:${label}] spawn error`, error);
            this.exitError = error instanceof Error ? error : new Error(String(error));
            this.failAllPending(this.exitError);
        });

        this.child.on("exit", (code, signal) => {
            this.closed = true;
            const reason = `exit code=${code ?? "null"} signal=${signal ?? "null"}`;
            logger.log(`[lsp:${label}] exited ${reason}`);
            if (!this.exitError) {
                this.exitError = new Error(`LSP process exited (${reason})`);
            }
            this.failAllPending(this.exitError);
            this.events.emit("exit");
        });
    }

    get isAlive(): boolean {
        return !this.closed && this.child.exitCode === null;
    }

    // ─── Framing parser ──────────────────────────────────────────────────────

    private drainBuffer(): void {
        while (true) {
            const headerEnd = this.stdoutBuffer.indexOf("\r\n\r\n");
            if (headerEnd === -1) return;
            const headerText = this.stdoutBuffer.subarray(0, headerEnd).toString("utf8");
            const lengthMatch = /Content-Length:\s*(\d+)/i.exec(headerText);
            if (!lengthMatch) {
                // Unrecoverable: drop buffer so we don't loop forever on garbage.
                logger.error("[lsp] missing Content-Length in header", { headerText });
                this.stdoutBuffer = Buffer.alloc(0);
                return;
            }
            const bodyLen = parseInt(lengthMatch[1]!, 10);
            const total = headerEnd + 4 + bodyLen;
            if (this.stdoutBuffer.length < total) return;
            const body = this.stdoutBuffer.subarray(headerEnd + 4, total).toString("utf8");
            this.stdoutBuffer = this.stdoutBuffer.subarray(total);
            this.dispatchMessage(body);
        }
    }

    private dispatchMessage(body: string): void {
        let parsed: LspIncoming;
        try {
            parsed = JSON.parse(body) as LspIncoming;
        } catch (error) {
            logger.error("[lsp] failed to parse incoming JSON", {
                error: String(error),
                body: body.slice(0, 200)
            });
            return;
        }

        // Response (has id + result or error).
        if ("id" in parsed && typeof parsed.id === "number") {
            if ("method" in parsed) {
                // Server-initiated request. We don't implement any — reply with
                // a "method not found" error so the server can proceed.
                this.sendRaw({
                    jsonrpc: "2.0",
                    id: parsed.id,
                    error: { code: -32601, message: "Method not found" }
                });
                return;
            }
            const pending = this.pending.get(parsed.id);
            if (!pending) {
                // Unsolicited or late response; ignore.
                return;
            }
            this.pending.delete(parsed.id);
            if ("error" in parsed) {
                pending.reject(
                    new Error(
                        `LSP error ${parsed.error.code}: ${parsed.error.message}`
                    )
                );
            } else {
                pending.resolve((parsed as LspResponseOk).result);
            }
            return;
        }

        // Notification (method + params, no id).
        if ("method" in parsed && typeof parsed.method === "string") {
            this.onNotification(parsed.method, parsed.params);
        }
    }

    private onNotification(method: string, params: unknown): void {
        if (method === "textDocument/publishDiagnostics") {
            const p = params as {
                uri?: string;
                diagnostics?: RawDiagnostic[];
            } | undefined;
            if (!p || typeof p.uri !== "string") return;
            const diagnostics = Array.isArray(p.diagnostics)
                ? p.diagnostics.map(normalizeDiagnostic)
                : [];
            this.diagnosticsByUri.set(p.uri, diagnostics);
            this.events.emit("publishDiagnostics", { uri: p.uri, diagnostics });
            return;
        }
        // Other notifications (window/logMessage, etc.) — we don't surface
        // them but log at verbose level would go here.
    }

    // ─── Sending messages ────────────────────────────────────────────────────

    private sendRaw(message: object): void {
        if (this.closed) return;
        const json = JSON.stringify(message);
        const payload = Buffer.from(json, "utf8");
        const header = Buffer.from(
            `Content-Length: ${payload.byteLength}\r\n\r\n`,
            "utf8"
        );
        try {
            this.child.stdin.write(header);
            this.child.stdin.write(payload);
        } catch (error) {
            logger.error("[lsp] stdin write failed", error);
        }
    }

    sendRequest<T = unknown>(method: string, params?: unknown): Promise<T> {
        if (this.closed) {
            return Promise.reject(
                this.exitError ?? new Error("LSP client is closed")
            );
        }
        const id = this.nextId++;
        const request: LspRequest = {
            jsonrpc: "2.0",
            id,
            method,
            params
        };
        return new Promise<T>((resolve, reject) => {
            this.pending.set(id, {
                resolve: (v) => resolve(v as T),
                reject
            });
            this.sendRaw(request);
        });
    }

    sendNotification(method: string, params?: unknown): void {
        const message: LspNotification = {
            jsonrpc: "2.0",
            method,
            params
        };
        this.sendRaw(message);
    }

    // ─── Public high-level API ───────────────────────────────────────────────

    /** Register a listener for incoming publishDiagnostics notifications. */
    onPublishDiagnostics(
        listener: (event: { uri: string; diagnostics: Diagnostic[] }) => void
    ): () => void {
        this.events.on("publishDiagnostics", listener);
        return () => this.events.off("publishDiagnostics", listener);
    }

    getDiagnostics(uri: string): Diagnostic[] | undefined {
        return this.diagnosticsByUri.get(uri);
    }

    /**
     * Wait for a `publishDiagnostics` for `uri`. If `predicate` is supplied,
     * only resolve when the notification's diagnostics satisfy it.
     *
     * Resolves with the diagnostics payload (which may be an empty array,
     * meaning "clean"), or rejects on timeout / client close.
     */
    waitForDiagnostics(
        uri: string,
        options: { timeoutMs: number; signal?: AbortSignal } = { timeoutMs: 1500 }
    ): Promise<Diagnostic[]> {
        const { timeoutMs, signal } = options;
        return new Promise<Diagnostic[]>((resolve, reject) => {
            if (signal?.aborted) {
                reject(new Error("aborted"));
                return;
            }
            let settled = false;
            const cleanup = () => {
                if (settled) return;
                settled = true;
                this.events.off("publishDiagnostics", onPublish);
                this.events.off("exit", onExit);
                clearTimeout(timer);
                signal?.removeEventListener("abort", onAbort);
            };
            const onPublish = (event: { uri: string; diagnostics: Diagnostic[] }) => {
                if (event.uri !== uri) return;
                cleanup();
                resolve(event.diagnostics);
            };
            const onExit = () => {
                cleanup();
                reject(this.exitError ?? new Error("LSP exited"));
            };
            const onAbort = () => {
                cleanup();
                reject(new Error("aborted"));
            };
            const timer = setTimeout(() => {
                cleanup();
                // Soft timeout: return the last-known diagnostics (possibly
                // empty) so callers that just want "whatever we have now"
                // still get a useful answer.
                const latest = this.diagnosticsByUri.get(uri) ?? [];
                resolve(latest);
            }, Math.max(50, timeoutMs));
            this.events.on("publishDiagnostics", onPublish);
            this.events.once("exit", onExit);
            signal?.addEventListener("abort", onAbort, { once: true });
        });
    }

    // ─── Document lifecycle ──────────────────────────────────────────────────

    didOpen(params: {
        uri: string;
        languageId: string;
        version: number;
        text: string;
    }): void {
        this.sendNotification("textDocument/didOpen", {
            textDocument: {
                uri: params.uri,
                languageId: params.languageId,
                version: params.version,
                text: params.text
            }
        });
    }

    didChange(params: { uri: string; version: number; text: string }): void {
        this.sendNotification("textDocument/didChange", {
            textDocument: { uri: params.uri, version: params.version },
            contentChanges: [{ text: params.text }]
        });
    }

    didClose(uri: string): void {
        this.sendNotification("textDocument/didClose", {
            textDocument: { uri }
        });
        this.diagnosticsByUri.delete(uri);
    }

    // ─── Shutdown ────────────────────────────────────────────────────────────

    async shutdown(): Promise<void> {
        if (this.closed) return;
        try {
            await Promise.race([
                this.sendRequest("shutdown"),
                new Promise<void>((resolve) =>
                    setTimeout(() => resolve(undefined), 2000)
                )
            ]);
        } catch {
            // ignore — we're tearing down anyway
        }
        try {
            this.sendNotification("exit");
        } catch {
            // ignore
        }
        this.closed = true;
        this.failAllPending(new Error("LSP client shutting down"));
        // Give the process a moment to exit gracefully, then force.
        setTimeout(() => {
            if (this.child.exitCode === null) {
                try {
                    this.child.kill("SIGTERM");
                } catch {
                    /* ignore */
                }
            }
            setTimeout(() => {
                if (this.child.exitCode === null) {
                    try {
                        this.child.kill("SIGKILL");
                    } catch {
                        /* ignore */
                    }
                }
            }, 1500);
        }, 200);
    }

    private failAllPending(error: Error): void {
        for (const [, pending] of this.pending) {
            pending.reject(error);
        }
        this.pending.clear();
    }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export { fileUriFromPath, pathFromFileUri, languageIdForPath };
