import {
    mkdirSync,
    openSync,
    readdirSync,
    readFileSync,
    readSync,
    closeSync,
    statSync,
    unlinkSync,
    writeFileSync
} from "node:fs";
import { join } from "node:path";
import { getHomePath } from "../../lib/homedir";
import { logger } from "../../lib/logger";
import type { Memory, MemoryIndexEntry } from "./memories.types";

// ─── Global LLM memories ──────────────────────────────────────────────────────
//
// Memories are global, titled markdown notes stored one-per-file under
// `~/.agnt/memories/<id>.md`. The filename (minus extension) is a UUID and
// is the memory's stable identifier. There is no index file — the
// directory IS the source of truth.
//
// File format:
//   # <title>
//   <blank line>
//   <free-form markdown body>
//
// If the first line is missing or doesn't start with `# `, we degrade to
// `title = "Untitled"` and treat the entire file as the body. This keeps
// the parser tolerant of files that were hand-edited or that the LLM
// produced without the leading title line.

const MEMORIES_DIR = getHomePath("memories");

const FILE_EXT = ".md";

const DEFAULT_TITLE = "Untitled";

const MAX_TITLE_LENGTH = 200;

// UUID v4-ish, but we accept any UUID-shaped id (8-4-4-4-12 hex). We never
// trust user input as a file path; this regex is the only thing that ever
// gets joined onto the memories dir, which closes off path-traversal entirely.
const ID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function ensureMemoriesDir(): void {
    try {
        mkdirSync(MEMORIES_DIR, { recursive: true });
    } catch {
        // directory already exists
    }
}

function isValidMemoryId(id: string): boolean {
    return ID_REGEX.test(id);
}

function memoryPath(id: string): string {
    return join(MEMORIES_DIR, `${id}${FILE_EXT}`);
}

export class MemoryNotFoundError extends Error {
    constructor(id: string) {
        super(`Memory not found: ${id}`);
        this.name = "MemoryNotFoundError";
    }
}

export class InvalidMemoryIdError extends Error {
    constructor(id: string) {
        super(`Invalid memory id: ${id}`);
        this.name = "InvalidMemoryIdError";
    }
}

function normalizeTitle(rawTitle: string): string {
    const collapsed = rawTitle.replace(/\s+/g, " ").trim();
    if (collapsed.length === 0) return DEFAULT_TITLE;
    return collapsed.length > MAX_TITLE_LENGTH
        ? collapsed.slice(0, MAX_TITLE_LENGTH)
        : collapsed;
}

function parseMemoryFile(text: string): { title: string; body: string } {
    // Find the first newline so we can isolate the title line without
    // building an array for the entire body.
    const firstNewline = text.indexOf("\n");
    const firstLine = firstNewline === -1 ? text : text.slice(0, firstNewline);
    const remainder = firstNewline === -1 ? "" : text.slice(firstNewline + 1);

    if (firstLine.startsWith("# ")) {
        const title = normalizeTitle(firstLine.slice(2));
        // Drop a single blank separator line if present so the round-tripped
        // body matches what the LLM passed in via `memory_write`.
        const body = remainder.startsWith("\n")
            ? remainder.slice(1)
            : remainder;
        return { title, body };
    }

    return { title: DEFAULT_TITLE, body: text };
}

function serializeMemoryFile(parts: { title: string; body: string }): string {
    const title = normalizeTitle(parts.title);
    return `# ${title}\n\n${parts.body}`;
}

function readMemoryFile(id: string): Memory | null {
    const filePath = memoryPath(id);
    try {
        const text = readFileSync(filePath, "utf8");
        const stat = statSync(filePath);
        const { title, body } = parseMemoryFile(text);
        return { id, title, body, updatedAt: stat.mtimeMs };
    } catch {
        return null;
    }
}

/**
 * Read just the title line of a memory file without slurping the entire
 * body. Memories are tiny in practice but bodies can grow without bound,
 * and the prompt-side index loader runs on every turn — so we cap each
 * file read at the first ~512 bytes, which is more than enough for a
 * 200-char title prefixed with `# `.
 */
function readMemoryIndexEntry(id: string): MemoryIndexEntry | null {
    const filePath = memoryPath(id);
    let stat;
    try {
        stat = statSync(filePath);
    } catch {
        return null;
    }

    const buffer = Buffer.alloc(512);
    let bytesRead = 0;
    let fd: number | null = null;
    try {
        fd = openSync(filePath, "r");
        bytesRead = readSync(fd, buffer, 0, buffer.length, 0);
    } catch {
        return null;
    } finally {
        if (fd !== null) {
            try {
                closeSync(fd);
            } catch {
                // ignore close errors
            }
        }
    }

    const head = buffer.toString("utf8", 0, bytesRead);
    const newlineIdx = head.indexOf("\n");
    const firstLine = newlineIdx === -1 ? head : head.slice(0, newlineIdx);
    const title = firstLine.startsWith("# ")
        ? normalizeTitle(firstLine.slice(2))
        : DEFAULT_TITLE;

    return { id, title, updatedAt: stat.mtimeMs };
}

/**
 * Return a fast index of every memory (id + title only). Used to inject
 * the memory directory into the system prompt without paying the cost
 * of reading every body on every turn.
 */
export function listMemoryIndex(): MemoryIndexEntry[] {
    ensureMemoriesDir();

    let entries: string[];
    try {
        entries = readdirSync(MEMORIES_DIR);
    } catch (error) {
        logger.error("[memories] failed to read memories dir", error);
        return [];
    }

    const index: MemoryIndexEntry[] = [];
    for (const entry of entries) {
        if (!entry.endsWith(FILE_EXT)) continue;
        const id = entry.slice(0, -FILE_EXT.length);
        if (!isValidMemoryId(id)) continue;

        const indexEntry = readMemoryIndexEntry(id);
        if (indexEntry) index.push(indexEntry);
    }

    // Newest-first: most recently written memories float to the top of the
    // index, matching how the LLM is likely to mentally rank "what did I
    // just save?".
    index.sort((a, b) => b.updatedAt - a.updatedAt);
    return index;
}

export function getMemory(id: string): Memory | null {
    if (!isValidMemoryId(id)) return null;
    return readMemoryFile(id);
}

export function createMemory(parts: {
    title: string;
    body: string;
}): Memory {
    ensureMemoriesDir();
    const id = crypto.randomUUID();
    const title = normalizeTitle(parts.title);
    const body = parts.body;

    writeFileSync(memoryPath(id), serializeMemoryFile({ title, body }), "utf8");

    const stat = statSync(memoryPath(id));
    return { id, title, body, updatedAt: stat.mtimeMs };
}

export function updateMemory(
    id: string,
    parts: { title?: string; body?: string }
): Memory {
    if (!isValidMemoryId(id)) throw new InvalidMemoryIdError(id);

    const existing = readMemoryFile(id);
    if (!existing) throw new MemoryNotFoundError(id);

    const title = normalizeTitle(parts.title ?? existing.title);
    const body = parts.body ?? existing.body;

    const filePath = memoryPath(id);
    writeFileSync(filePath, serializeMemoryFile({ title, body }), "utf8");
    const stat = statSync(filePath);
    return { id, title, body, updatedAt: stat.mtimeMs };
}

/**
 * Convenience helper used by the `memory_write` tool. If `id` is provided
 * the memory is updated in place; otherwise a new one is created with a
 * freshly-minted UUID. Returns the resulting memory plus a `created`
 * flag so the tool result can tell the LLM which path it took.
 */
export function upsertMemory(parts: {
    id?: string;
    title: string;
    body: string;
}): { memory: Memory; created: boolean } {
    if (parts.id !== undefined) {
        const memory = updateMemory(parts.id, {
            title: parts.title,
            body: parts.body
        });
        return { memory, created: false };
    }
    const memory = createMemory({ title: parts.title, body: parts.body });
    return { memory, created: true };
}

export function deleteMemory(id: string): void {
    if (!isValidMemoryId(id)) throw new InvalidMemoryIdError(id);

    try {
        unlinkSync(memoryPath(id));
    } catch (error) {
        const code =
            error && typeof error === "object" && "code" in error
                ? (error as { code?: string }).code
                : undefined;
        if (code === "ENOENT") {
            throw new MemoryNotFoundError(id);
        }
        throw error;
    }
}
