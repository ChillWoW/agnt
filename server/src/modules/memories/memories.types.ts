// ─── Global LLM memories ──────────────────────────────────────────────────────
//
// A memory is a titled markdown note authored by the LLM via the `memory_*`
// tools. Persisted as one file per memory at `~/.agnt/memories/<id>.md`,
// where `<id>` is a UUID. The first line of the file is `# <title>`,
// followed by a blank line, then the free-form markdown body.
//
// Memories are global across every workspace. There is no per-workspace
// scope, no enabled toggle, no tagging — just a flat global pool.
//
// `updatedAt` is the file's `mtime` in ms; the index is returned newest-first.

export interface Memory {
    id: string;
    title: string;
    body: string;
    updatedAt: number;
}

export interface MemoryIndexEntry {
    id: string;
    title: string;
    updatedAt: number;
}
