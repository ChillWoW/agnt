import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
    BrowserFaviconEvent,
    BrowserLoadStateEvent,
    BrowserNavigatedEvent,
    BrowserTitleEvent,
    BrowserUrlReportEvent
} from "./browser-types";

export interface OpenBrowserOptions {
    id: string;
    url: string;
    x: number;
    y: number;
    width: number;
    height: number;
}

export async function openBrowser(opts: OpenBrowserOptions): Promise<void> {
    await invoke("browser_open", {
        id: opts.id,
        url: opts.url,
        x: opts.x,
        y: opts.y,
        width: Math.max(1, opts.width),
        height: Math.max(1, opts.height)
    });
}

export async function navigateBrowser(id: string, url: string): Promise<void> {
    await invoke("browser_navigate", { id, url });
}

export async function backBrowser(id: string): Promise<void> {
    await invoke("browser_back", { id });
}

export async function forwardBrowser(id: string): Promise<void> {
    await invoke("browser_forward", { id });
}

export async function reloadBrowser(id: string): Promise<void> {
    await invoke("browser_reload", { id });
}

export async function stopBrowser(id: string): Promise<void> {
    await invoke("browser_stop", { id });
}

export async function setBrowserBounds(
    id: string,
    x: number,
    y: number,
    width: number,
    height: number
): Promise<void> {
    await invoke("browser_set_bounds", {
        id,
        x,
        y,
        width: Math.max(1, width),
        height: Math.max(1, height)
    });
}

export async function setBrowserVisible(
    id: string,
    visible: boolean
): Promise<void> {
    await invoke("browser_set_visible", { id, visible });
}

export async function closeBrowser(id: string): Promise<void> {
    await invoke("browser_close", { id });
}

export async function listAliveBrowsers(): Promise<string[]> {
    return await invoke<string[]>("browser_list_alive");
}

// Future browser-tools — the agent surface plumbed through the same
// IPC channel. Today only `eval` is exposed; once `__agnt_browser__`
// in the preload grows real implementations, additional tool helpers
// (snapshot, click, type, screenshot) will land here.
export async function evalBrowser(id: string, js: string): Promise<void> {
    await invoke("browser_eval", { id, js });
}

// Per-id subscribers — share a single global listen() per channel and
// fan out to per-id callbacks (mirrors terminal-bridge.ts so we don't
// open a new IPC listener for every browser tab).

type Cb<T> = (event: T) => void;

const navigatedListeners = new Map<string, Set<Cb<BrowserNavigatedEvent>>>();
const titleListeners = new Map<string, Set<Cb<BrowserTitleEvent>>>();
const faviconListeners = new Map<string, Set<Cb<BrowserFaviconEvent>>>();
const loadStateListeners = new Map<string, Set<Cb<BrowserLoadStateEvent>>>();
const urlReportListeners = new Map<string, Set<Cb<BrowserUrlReportEvent>>>();

let navigatedUnlisten: Promise<UnlistenFn> | null = null;
let titleUnlisten: Promise<UnlistenFn> | null = null;
let faviconUnlisten: Promise<UnlistenFn> | null = null;
let loadStateUnlisten: Promise<UnlistenFn> | null = null;
let urlReportUnlisten: Promise<UnlistenFn> | null = null;

function fanOut<T extends { id: string }>(
    map: Map<string, Set<Cb<T>>>,
    payload: T
) {
    const set = map.get(payload.id);
    if (!set) return;
    for (const cb of set) {
        try {
            cb(payload);
        } catch {
            // ignore individual subscriber failures
        }
    }
}

function ensureNavigatedListener(): void {
    if (navigatedUnlisten) return;
    navigatedUnlisten = listen<BrowserNavigatedEvent>(
        "browser://navigated",
        (e) => fanOut(navigatedListeners, e.payload)
    );
}

function ensureTitleListener(): void {
    if (titleUnlisten) return;
    titleUnlisten = listen<BrowserTitleEvent>("browser://title", (e) =>
        fanOut(titleListeners, e.payload)
    );
}

function ensureFaviconListener(): void {
    if (faviconUnlisten) return;
    faviconUnlisten = listen<BrowserFaviconEvent>("browser://favicon", (e) =>
        fanOut(faviconListeners, e.payload)
    );
}

function ensureLoadStateListener(): void {
    if (loadStateUnlisten) return;
    loadStateUnlisten = listen<BrowserLoadStateEvent>(
        "browser://load-state",
        (e) => fanOut(loadStateListeners, e.payload)
    );
}

function ensureUrlReportListener(): void {
    if (urlReportUnlisten) return;
    urlReportUnlisten = listen<BrowserUrlReportEvent>(
        "browser://url-report",
        (e) => fanOut(urlReportListeners, e.payload)
    );
}

function subscribe<T>(
    map: Map<string, Set<Cb<T>>>,
    id: string,
    cb: Cb<T>
): () => void {
    const set = map.get(id) ?? new Set();
    set.add(cb);
    map.set(id, set);
    return () => {
        const current = map.get(id);
        if (!current) return;
        current.delete(cb);
        if (current.size === 0) map.delete(id);
    };
}

export function subscribeNavigated(
    id: string,
    cb: Cb<BrowserNavigatedEvent>
): () => void {
    ensureNavigatedListener();
    return subscribe(navigatedListeners, id, cb);
}

export function subscribeTitle(
    id: string,
    cb: Cb<BrowserTitleEvent>
): () => void {
    ensureTitleListener();
    return subscribe(titleListeners, id, cb);
}

export function subscribeFavicon(
    id: string,
    cb: Cb<BrowserFaviconEvent>
): () => void {
    ensureFaviconListener();
    return subscribe(faviconListeners, id, cb);
}

export function subscribeLoadState(
    id: string,
    cb: Cb<BrowserLoadStateEvent>
): () => void {
    ensureLoadStateListener();
    return subscribe(loadStateListeners, id, cb);
}

export function subscribeUrlReport(
    id: string,
    cb: Cb<BrowserUrlReportEvent>
): () => void {
    ensureUrlReportListener();
    return subscribe(urlReportListeners, id, cb);
}
