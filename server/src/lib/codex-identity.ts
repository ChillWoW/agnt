import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { arch as nodeArch, platform, release } from "node:os";
import { join } from "node:path";

import { getHomeDir, getHomePath } from "./homedir";

/**
 * Identity headers we send on every Codex backend request, mirroring the
 * official Codex CLI (codex-rs):
 *
 *   - `originator`           — `codex_cli_rs` so this client is recognized as
 *                              an authorized first-party Codex client and
 *                              billed against the user's Plus/Team plan.
 *   - `User-Agent`           — `codex_cli_rs/<ver> (<os> <release>; <arch>)`,
 *                              matching `get_codex_user_agent()` in
 *                              `codex-rs/login/src/auth/default_client.rs`.
 *   - `x-codex-installation-id` — stable UUID persisted to `~/.agnt/installation-id`
 *                              that uniquely identifies this install across
 *                              restarts.
 *   - `x-codex-window-id`    — UUID generated once per server process; lets the
 *                              backend group multiple sessions opened from the
 *                              same agnt boot.
 *
 * These are the headers most likely responsible for token-pricing parity:
 * unidentified clients can fall into more expensive rate buckets, even when
 * the OAuth bearer is valid.
 */

const CODEX_ORIGINATOR = "codex_cli_rs";
const INSTALLATION_ID_FILENAME = "installation-id";

let cachedInstallationId: string | null = null;
let cachedWindowId: string | null = null;
let cachedUserAgent: string | null = null;

function isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        value
    );
}

export function getOriginator(): string {
    return CODEX_ORIGINATOR;
}

/**
 * Returns the stable installation id, reading or creating
 * `~/.agnt/installation-id` on disk. Mirrors how Codex CLI persists its own
 * installation id so the backend can track this install across restarts.
 */
export function getInstallationId(): string {
    if (cachedInstallationId) return cachedInstallationId;

    const filePath = getHomePath(INSTALLATION_ID_FILENAME);

    try {
        const raw = readFileSync(filePath, "utf8").trim();
        if (raw.length > 0 && isUuid(raw)) {
            cachedInstallationId = raw;
            return cachedInstallationId;
        }
    } catch {
        // File does not exist yet (or is unreadable) — fall through and create.
    }

    const id = crypto.randomUUID();

    try {
        mkdirSync(getHomeDir(), { recursive: true });
        writeFileSync(filePath, `${id}\n`, "utf8");
    } catch {
        // If we can't persist, still return the in-memory id for this run.
    }

    cachedInstallationId = id;
    return cachedInstallationId;
}

/**
 * Per-process UUID generated once at first call. Codex CLI generates a fresh
 * window id at boot; we do the same.
 */
export function getWindowId(): string {
    if (!cachedWindowId) {
        cachedWindowId = crypto.randomUUID();
    }
    return cachedWindowId;
}

/**
 * Lazily reads the agnt server package.json once to find the version we
 * advertise in the User-Agent. Falls back to "0.0.0" on any error.
 */
function readAgntVersion(): string {
    try {
        // server/src/lib/codex-identity.ts → server/package.json
        const pkgPath = join(import.meta.dir ?? __dirname, "..", "..", "package.json");
        const raw = readFileSync(pkgPath, "utf8");
        const pkg = JSON.parse(raw) as { version?: string };
        if (typeof pkg.version === "string" && pkg.version.length > 0) {
            return pkg.version;
        }
    } catch {
        // ignore — fall through to default
    }
    return "0.0.0";
}

function describeOsType(): string {
    const p = platform();
    if (p === "darwin") return "Mac OS";
    if (p === "win32") return "Windows";
    if (p === "linux") return "Linux";
    return p;
}

function describeArch(): string {
    const a = nodeArch();
    if (a === "x64") return "x86_64";
    if (a === "arm64") return "arm64";
    if (a === "ia32") return "x86";
    return a;
}

/**
 * Build the Codex-style User-Agent header value:
 *   `codex_cli_rs/<version> (<os-type> <release>; <arch>)`
 *
 * We deliberately do NOT append a terminal-detection suffix (Codex CLI's
 * `user_agent()`); agnt is not a terminal client. The shape matches the
 * `prefix` portion of `get_codex_user_agent()` in codex-rs.
 *
 * Values are sanitized to ASCII printable characters so the result is always
 * a valid HTTP header value.
 */
export function getCodexUserAgent(): string {
    if (cachedUserAgent) return cachedUserAgent;

    const version = readAgntVersion();
    const candidate = `${CODEX_ORIGINATOR}/${version} (${describeOsType()} ${release()}; ${describeArch()})`;

    let sanitized = "";
    for (const char of candidate) {
        const code = char.charCodeAt(0);
        sanitized += code >= 0x20 && code <= 0x7e ? char : "_";
    }

    if (sanitized.length === 0) sanitized = `${CODEX_ORIGINATOR}/${version}`;

    cachedUserAgent = sanitized;
    return cachedUserAgent;
}
