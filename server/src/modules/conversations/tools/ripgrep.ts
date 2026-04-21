import { logger } from "../../../lib/logger";

let cachedRgPath: string | null | undefined = undefined;

/**
 * Look up `rg` on PATH. Result is cached for the lifetime of the process
 * (user installing ripgrep mid-session is an edge case not worth a refresh
 * button). Returns null when ripgrep is not available, in which case
 * callers should fall back to the pure-node walker.
 */
export function getRipgrepPath(): string | null {
    if (cachedRgPath !== undefined) return cachedRgPath;
    try {
        const bunWhich = (Bun as unknown as { which?: (bin: string) => string | null })
            .which;
        const found = bunWhich ? bunWhich("rg") : null;
        cachedRgPath = typeof found === "string" && found.length > 0 ? found : null;
    } catch {
        cachedRgPath = null;
    }
    logger.log("[ripgrep] detection", { path: cachedRgPath });
    return cachedRgPath;
}

export interface RipgrepRun {
    stdout: string;
    stderr: string;
    exitCode: number;
    timedOut: boolean;
    stdoutTruncated: boolean;
}

const MAX_STDOUT_BYTES = 16 * 1024 * 1024; // 16 MB
const MAX_STDERR_BYTES = 128 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;

async function readStream(
    stream: ReadableStream<Uint8Array>,
    maxBytes: number
): Promise<{ text: string; truncated: boolean }> {
    const decoder = new TextDecoder();
    const reader = stream.getReader();
    let text = "";
    let truncated = false;
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            text += decoder.decode(value, { stream: true });
            if (text.length > maxBytes) {
                truncated = true;
                break;
            }
        }
        text += decoder.decode();
    } finally {
        try {
            reader.releaseLock();
        } catch {
            /* noop */
        }
    }
    return { text, truncated };
}

/**
 * Spawn ripgrep and capture stdout/stderr with size + time caps so a
 * pathological search can't hang the server. Does not throw on non-zero
 * exit codes (rg uses exit code 1 for "no matches" which is normal).
 */
export async function runRipgrep(
    args: string[],
    cwd: string,
    options: { timeoutMs?: number } = {}
): Promise<RipgrepRun> {
    const rgPath = getRipgrepPath();
    if (!rgPath) throw new Error("ripgrep (rg) is not available on PATH");

    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const proc = Bun.spawn([rgPath, ...args], {
        cwd,
        stdout: "pipe",
        stderr: "pipe"
    });

    let timedOut = false;
    const timer = setTimeout(() => {
        timedOut = true;
        try {
            proc.kill();
        } catch {
            /* noop */
        }
    }, timeoutMs);

    const [stdoutRes, stderrRes] = await Promise.all([
        readStream(proc.stdout as ReadableStream<Uint8Array>, MAX_STDOUT_BYTES),
        readStream(proc.stderr as ReadableStream<Uint8Array>, MAX_STDERR_BYTES)
    ]);

    if (stdoutRes.truncated) {
        try {
            proc.kill();
        } catch {
            /* noop */
        }
    }

    const exitCode = await proc.exited;
    clearTimeout(timer);

    return {
        stdout: stdoutRes.text,
        stderr: stderrRes.text,
        exitCode,
        timedOut,
        stdoutTruncated: stdoutRes.truncated
    };
}
