import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { TerminalExitEvent, TerminalOutputEvent } from "./terminal-types";

export interface OpenTerminalOptions {
    id: string;
    workspaceId: string;
    cwd: string;
    cols: number;
    rows: number;
    shell?: string;
}

export async function openTerminal(opts: OpenTerminalOptions): Promise<void> {
    await invoke("terminal_open", {
        id: opts.id,
        workspaceId: opts.workspaceId,
        cwd: opts.cwd,
        cols: Math.max(2, Math.floor(opts.cols)),
        rows: Math.max(2, Math.floor(opts.rows)),
        shell: opts.shell ?? null
    });
}

export async function writeTerminal(id: string, data: string): Promise<void> {
    await invoke("terminal_write", { id, data });
}

export async function resizeTerminal(
    id: string,
    cols: number,
    rows: number
): Promise<void> {
    await invoke("terminal_resize", {
        id,
        cols: Math.max(2, Math.floor(cols)),
        rows: Math.max(2, Math.floor(rows))
    });
}

export async function closeTerminal(id: string): Promise<void> {
    await invoke("terminal_close", { id });
}

export async function listAliveTerminals(): Promise<string[]> {
    return await invoke<string[]>("terminal_list_alive");
}

// Per-id subscribers — share a single global listen() per channel and fan
// out to per-id callbacks so we don't open a new IPC listener for every
// terminal.

type OutputCallback = (event: TerminalOutputEvent) => void;
type ExitCallback = (event: TerminalExitEvent) => void;

const outputListeners = new Map<string, Set<OutputCallback>>();
const exitListeners = new Map<string, Set<ExitCallback>>();

let outputUnlistenPromise: Promise<UnlistenFn> | null = null;
let exitUnlistenPromise: Promise<UnlistenFn> | null = null;

function ensureOutputListener(): void {
    if (outputUnlistenPromise) return;
    outputUnlistenPromise = listen<TerminalOutputEvent>(
        "terminal://output",
        (e) => {
            const payload = e.payload;
            const set = outputListeners.get(payload.id);
            if (!set) return;
            for (const cb of set) {
                try {
                    cb(payload);
                } catch {
                    // ignore individual subscriber failures
                }
            }
        }
    );
}

function ensureExitListener(): void {
    if (exitUnlistenPromise) return;
    exitUnlistenPromise = listen<TerminalExitEvent>("terminal://exit", (e) => {
        const payload = e.payload;
        const set = exitListeners.get(payload.id);
        if (!set) return;
        for (const cb of set) {
            try {
                cb(payload);
            } catch {
                // ignore
            }
        }
    });
}

export function subscribeOutput(id: string, cb: OutputCallback): () => void {
    ensureOutputListener();
    const set = outputListeners.get(id) ?? new Set();
    set.add(cb);
    outputListeners.set(id, set);
    return () => {
        const current = outputListeners.get(id);
        if (!current) return;
        current.delete(cb);
        if (current.size === 0) outputListeners.delete(id);
    };
}

export function subscribeExit(id: string, cb: ExitCallback): () => void {
    ensureExitListener();
    const set = exitListeners.get(id) ?? new Set();
    set.add(cb);
    exitListeners.set(id, set);
    return () => {
        const current = exitListeners.get(id);
        if (!current) return;
        current.delete(cb);
        if (current.size === 0) exitListeners.delete(id);
    };
}
