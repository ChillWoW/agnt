import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import {
    closeTerminal as bridgeCloseTerminal,
    listAliveTerminals,
    openTerminal,
    resizeTerminal,
    subscribeExit,
    subscribeOutput,
    writeTerminal
} from "./terminal-bridge";
import { useTerminalStore } from "./terminal-store";
import type { TerminalDescriptor } from "./terminal-types";

interface SessionRuntime {
    id: string;
    descriptor: TerminalDescriptor;
    term: Terminal;
    fit: FitAddon;
    wrapper: HTMLDivElement;
    unsubOutput: () => void;
    unsubExit: () => void;
    opened: boolean;
    ptyOpened: boolean;
    alive: boolean;
    lastCols: number;
    lastRows: number;
}

const sessions = new Map<string, SessionRuntime>();
const fitTimers = new Map<string, number>();

let aliveIdsPromise: Promise<Set<string>> | null = null;
function getAliveIds(): Promise<Set<string>> {
    if (!aliveIdsPromise) {
        aliveIdsPromise = listAliveTerminals()
            .then((ids) => new Set(ids))
            .catch(() => new Set<string>());
    }
    return aliveIdsPromise;
}

let poolDiv: HTMLDivElement | null = null;
function getPool(): HTMLDivElement {
    if (poolDiv) return poolDiv;
    poolDiv = document.createElement("div");
    poolDiv.style.position = "fixed";
    poolDiv.style.left = "-99999px";
    poolDiv.style.top = "-99999px";
    poolDiv.style.width = "800px";
    poolDiv.style.height = "400px";
    poolDiv.style.visibility = "hidden";
    poolDiv.style.pointerEvents = "none";
    poolDiv.setAttribute("aria-hidden", "true");
    document.body.appendChild(poolDiv);
    return poolDiv;
}

function buildTerminal(): { term: Terminal; fit: FitAddon } {
    const term = new Terminal({
        cursorBlink: true,
        cursorStyle: "bar",
        fontFamily:
            '"JetBrainsMono Nerd Font", "JetBrains Mono", "Cascadia Code", "Fira Code", Menlo, Consolas, "Courier New", monospace',
        fontSize: 12,
        lineHeight: 1.2,
        scrollback: 5000,
        allowProposedApi: true,
        convertEol: false,
        theme: {
            background: "#0d0d0d",
            foreground: "#c9c9c9",
            cursor: "#c9c9c9",
            cursorAccent: "#0d0d0d",
            selectionBackground: "#3b3b3b",
            black: "#1a1a1a",
            red: "#e06c75",
            green: "#98c379",
            yellow: "#e5c07b",
            blue: "#61afef",
            magenta: "#c678dd",
            cyan: "#56b6c2",
            white: "#c9c9c9",
            brightBlack: "#5c6370",
            brightRed: "#e06c75",
            brightGreen: "#98c379",
            brightYellow: "#e5c07b",
            brightBlue: "#61afef",
            brightMagenta: "#c678dd",
            brightCyan: "#56b6c2",
            brightWhite: "#ffffff"
        }
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    return { term, fit };
}

export function getSession(id: string): SessionRuntime | undefined {
    return sessions.get(id);
}

export function ensureSession(descriptor: TerminalDescriptor): SessionRuntime {
    const existing = sessions.get(descriptor.id);
    if (existing) return existing;

    const wrapper = document.createElement("div");
    wrapper.style.width = "100%";
    wrapper.style.height = "100%";
    wrapper.dataset.terminalId = descriptor.id;
    // NOTE: wrapper is intentionally NOT attached to the DOM here. We defer
    // term.open() until the wrapper lands in the real visible container so
    // xterm initializes at the correct dimensions. Otherwise we'd open at the
    // hidden pool's 800x400 box and then have to reflow on first mount, which
    // ConPTY notoriously mishandles and leaves stale rows in the buffer.

    const { term, fit } = buildTerminal();

    // term.write() works against the buffer before term.open(); the renderer
    // picks up whatever is in the buffer when it's eventually attached.
    const store = useTerminalStore.getState();
    const persistedScrollback =
        store.scrollbackByTerminalId[descriptor.id] ?? "";
    if (persistedScrollback.length > 0) {
        term.write(persistedScrollback);
    }

    const runtime: SessionRuntime = {
        id: descriptor.id,
        descriptor,
        term,
        fit,
        wrapper,
        unsubOutput: () => {},
        unsubExit: () => {},
        opened: false,
        ptyOpened: false,
        alive: false,
        lastCols: 0,
        lastRows: 0
    };

    runtime.unsubOutput = subscribeOutput(descriptor.id, (event) => {
        runtime.term.write(event.data);
        useTerminalStore.getState().appendScrollback(descriptor.id, event.data);
    });

    runtime.unsubExit = subscribeExit(descriptor.id, () => {
        runtime.alive = false;
        runtime.term.write(
            "\r\n\x1b[2m[Process exited — close this terminal or open a new one]\x1b[0m\r\n"
        );
    });

    term.onData((data) => {
        if (!runtime.alive) return;
        void writeTerminal(descriptor.id, data).catch(() => {
            runtime.alive = false;
        });
    });

    term.onResize(({ cols, rows }) => {
        if (!runtime.alive) return;
        if (cols === runtime.lastCols && rows === runtime.lastRows) return;
        runtime.lastCols = cols;
        runtime.lastRows = rows;
        void resizeTerminal(descriptor.id, cols, rows).catch(() => {});
    });

    sessions.set(descriptor.id, runtime);

    return runtime;
}

async function initPty(runtime: SessionRuntime): Promise<void> {
    try {
        const aliveIds = await getAliveIds();
        if (aliveIds.has(runtime.descriptor.id)) {
            // Re-attach: PTY survived a webview reload. Push the current xterm
            // dims to ConPTY/openpty so it lines up with what we're about to
            // render.
            runtime.alive = true;
            runtime.lastCols = runtime.term.cols;
            runtime.lastRows = runtime.term.rows;
            try {
                await resizeTerminal(
                    runtime.descriptor.id,
                    runtime.term.cols,
                    runtime.term.rows
                );
            } catch {
                // ignore
            }
            return;
        }

        const persistedScrollback =
            useTerminalStore.getState().scrollbackByTerminalId[
                runtime.descriptor.id
            ] ?? "";
        if (persistedScrollback.length > 0) {
            runtime.term.write(
                "\r\n\x1b[2m[Restored from previous session — starting a fresh shell]\x1b[0m\r\n"
            );
        }
        runtime.lastCols = runtime.term.cols;
        runtime.lastRows = runtime.term.rows;
        await openTerminal({
            id: runtime.descriptor.id,
            workspaceId: runtime.descriptor.workspaceId,
            cwd: runtime.descriptor.cwd,
            cols: runtime.term.cols,
            rows: runtime.term.rows
        });
        aliveIds.add(runtime.descriptor.id);
        runtime.alive = true;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        runtime.term.write(
            `\r\n\x1b[31m[Failed to spawn shell: ${message}]\x1b[0m\r\n`
        );
        runtime.alive = false;
    }
}

export function mountSession(
    id: string,
    container: HTMLElement
): SessionRuntime | undefined {
    const runtime = sessions.get(id);
    if (!runtime) return undefined;
    if (runtime.wrapper.parentElement !== container) {
        container.appendChild(runtime.wrapper);
    }

    if (!runtime.opened) {
        runtime.term.open(runtime.wrapper);
        runtime.opened = true;
    }

    requestAnimationFrame(() => {
        try {
            runtime.fit.fit();
        } catch {
            // ignore
        }
        try {
            runtime.term.focus();
        } catch {
            // ignore
        }
        if (!runtime.ptyOpened) {
            runtime.ptyOpened = true;
            void initPty(runtime);
        }
        // After (re)mount, force a renderer refresh so any partial paint state
        // from the hidden pool gets fully redrawn against the real container.
        try {
            runtime.term.refresh(0, runtime.term.rows - 1);
        } catch {
            // ignore
        }
    });

    return runtime;
}

export function unmountSession(id: string): void {
    const runtime = sessions.get(id);
    if (!runtime) return;
    const existingTimer = fitTimers.get(id);
    if (existingTimer) {
        window.clearTimeout(existingTimer);
        fitTimers.delete(id);
    }
    if (!runtime.opened) {
        // xterm renderer was never attached; just remove the wrapper if it
        // somehow ended up in the DOM.
        if (runtime.wrapper.parentElement) {
            runtime.wrapper.parentElement.removeChild(runtime.wrapper);
        }
        return;
    }
    if (runtime.wrapper.parentElement !== getPool()) {
        getPool().appendChild(runtime.wrapper);
    }
}

export function fitSession(id: string): void {
    const runtime = sessions.get(id);
    if (!runtime) return;
    if (!runtime.opened) return;
    if (!runtime.wrapper.isConnected) return;
    try {
        runtime.fit.fit();
    } catch {
        // ignore
    }
}

export function debouncedFitSession(id: string, delayMs: number = 80): void {
    const existing = fitTimers.get(id);
    if (existing) window.clearTimeout(existing);
    const timer = window.setTimeout(() => {
        fitTimers.delete(id);
        fitSession(id);
    }, delayMs);
    fitTimers.set(id, timer);
}

export async function disposeSession(id: string): Promise<void> {
    const runtime = sessions.get(id);
    if (!runtime) return;
    sessions.delete(id);
    const fitTimer = fitTimers.get(id);
    if (fitTimer) {
        window.clearTimeout(fitTimer);
        fitTimers.delete(id);
    }
    runtime.unsubOutput();
    runtime.unsubExit();
    if (runtime.ptyOpened) {
        try {
            await bridgeCloseTerminal(id);
        } catch {
            // ignore
        }
    }
    try {
        runtime.term.dispose();
    } catch {
        // ignore
    }
    if (runtime.wrapper.parentElement) {
        runtime.wrapper.parentElement.removeChild(runtime.wrapper);
    }
    const aliveIds = await getAliveIds();
    aliveIds.delete(id);
}
