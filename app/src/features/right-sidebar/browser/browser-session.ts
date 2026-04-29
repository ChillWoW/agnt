import {
    closeBrowser,
    listAliveBrowsers,
    openBrowser,
    setBrowserBounds,
    setBrowserVisible,
    subscribeFavicon,
    subscribeLoadState,
    subscribeNavigated,
    subscribeTitle,
    subscribeUrlReport
} from "./browser-bridge";
import { useBrowserStore } from "./browser-store";

// One Tauri child webview per tab. The webview is a native overlay
// that sits over a placeholder div in the right sidebar — `mountSession`
// keeps the webview's bounds synced with the placeholder's
// `getBoundingClientRect()`, debounced via rAF so a panel-resize drag
// doesn't fire one IPC per frame.
//
// Webviews are created lazily when the user submits a URL (see
// `BrowserTabView`). A tab whose `url` is empty has no webview
// allocated — the React "new tab" page renders in its place.

interface BrowserSession {
    id: string;
    isOpened: boolean;
    pendingFrame: number | null;
    lastBounds: Bounds | null;
    eventUnsubs: Array<() => void>;
    mounted: HTMLElement | null;
    resizeObserver: ResizeObserver | null;
    intersectionObserver: IntersectionObserver | null;
    onWindowResize: (() => void) | null;
}

interface Bounds {
    x: number;
    y: number;
    width: number;
    height: number;
}

const sessions = new Map<string, BrowserSession>();

function getOrCreateSession(id: string): BrowserSession {
    let session = sessions.get(id);
    if (session) return session;
    session = {
        id,
        isOpened: false,
        pendingFrame: null,
        lastBounds: null,
        eventUnsubs: [],
        mounted: null,
        resizeObserver: null,
        intersectionObserver: null,
        onWindowResize: null
    };
    sessions.set(id, session);
    return session;
}

function attachEventSubscriptions(session: BrowserSession): void {
    if (session.eventUnsubs.length > 0) return;
    const id = session.id;
    const store = useBrowserStore.getState();

    session.eventUnsubs.push(
        subscribeNavigated(id, (e) => {
            useBrowserStore.getState().setUrl(id, e.url);
        }),
        subscribeUrlReport(id, (e) => {
            useBrowserStore.getState().setUrl(id, e.url);
        }),
        subscribeTitle(id, (e) => {
            useBrowserStore.getState().setTitle(id, e.title);
        }),
        subscribeFavicon(id, (e) => {
            useBrowserStore.getState().setFavicon(id, e.favicon);
        }),
        subscribeLoadState(id, (e) => {
            useBrowserStore.getState().setLoading(id, e.isLoading);
        })
    );

    // Mark the prior persisted state as not-loading on hot-reload, in
    // case a load-state Started/Finished pair was missed.
    store.setLoading(id, false);
}

function clearEventSubscriptions(session: BrowserSession): void {
    for (const unsub of session.eventUnsubs) {
        try {
            unsub();
        } catch {
            // ignore
        }
    }
    session.eventUnsubs = [];
}

export async function ensureBrowserOpened(
    id: string,
    url: string,
    initialBounds: Bounds
): Promise<void> {
    const session = getOrCreateSession(id);
    if (session.isOpened) return;
    attachEventSubscriptions(session);
    try {
        await openBrowser({
            id,
            url,
            x: initialBounds.x,
            y: initialBounds.y,
            width: initialBounds.width,
            height: initialBounds.height
        });
        session.isOpened = true;
        session.lastBounds = initialBounds;
    } catch (err) {
        // Open failed — likely an invalid URL or a Tauri runtime error.
        // Surface to console; the React layer will keep the tab in its
        // "new tab" state so the user can retry.
        console.error("[browser] openBrowser failed", err);
        throw err;
    }
}

export function isBrowserOpened(id: string): boolean {
    return sessions.get(id)?.isOpened ?? false;
}

function readBounds(el: HTMLElement): Bounds {
    const rect = el.getBoundingClientRect();
    return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height
    };
}

function boundsAlmostEqual(a: Bounds | null, b: Bounds): boolean {
    if (!a) return false;
    return (
        Math.abs(a.x - b.x) < 0.5 &&
        Math.abs(a.y - b.y) < 0.5 &&
        Math.abs(a.width - b.width) < 0.5 &&
        Math.abs(a.height - b.height) < 0.5
    );
}

function scheduleSync(session: BrowserSession): void {
    if (!session.mounted || !session.isOpened) return;
    if (session.pendingFrame != null) return;
    session.pendingFrame = requestAnimationFrame(() => {
        session.pendingFrame = null;
        if (!session.mounted || !session.isOpened) return;
        const bounds = readBounds(session.mounted);
        if (boundsAlmostEqual(session.lastBounds, bounds)) return;
        session.lastBounds = bounds;
        void setBrowserBounds(
            session.id,
            bounds.x,
            bounds.y,
            bounds.width,
            bounds.height
        );
    });
}

export function mountBrowser(id: string, el: HTMLElement): () => void {
    const session = getOrCreateSession(id);
    session.mounted = el;

    if (session.isOpened) {
        // Becoming visible again — re-show and force a fresh bounds sync.
        void setBrowserVisible(id, true);
        session.lastBounds = null;
        scheduleSync(session);
    }

    const ro = new ResizeObserver(() => scheduleSync(session));
    ro.observe(el);
    session.resizeObserver = ro;

    const onResize = () => scheduleSync(session);
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    session.onWindowResize = onResize;

    return () => {
        if (session.resizeObserver) {
            session.resizeObserver.disconnect();
            session.resizeObserver = null;
        }
        if (session.onWindowResize) {
            window.removeEventListener("resize", session.onWindowResize);
            window.removeEventListener(
                "scroll",
                session.onWindowResize,
                true
            );
            session.onWindowResize = null;
        }
        if (session.pendingFrame != null) {
            cancelAnimationFrame(session.pendingFrame);
            session.pendingFrame = null;
        }
        session.mounted = null;
        if (session.isOpened) {
            // Park the native webview offscreen so it doesn't paint
            // over whatever takes our place in the right sidebar.
            void setBrowserVisible(id, false);
        }
    };
}

export function syncMountedBounds(id: string): void {
    const session = sessions.get(id);
    if (!session) return;
    scheduleSync(session);
}

export async function setSessionVisible(
    id: string,
    visible: boolean
): Promise<void> {
    const session = sessions.get(id);
    if (!session?.isOpened) return;
    if (visible) {
        await setBrowserVisible(id, true);
        session.lastBounds = null;
        scheduleSync(session);
    } else {
        await setBrowserVisible(id, false);
    }
}

export async function disposeBrowserSession(id: string): Promise<void> {
    const session = sessions.get(id);
    if (!session) return;
    clearEventSubscriptions(session);
    if (session.pendingFrame != null) {
        cancelAnimationFrame(session.pendingFrame);
        session.pendingFrame = null;
    }
    if (session.resizeObserver) {
        session.resizeObserver.disconnect();
        session.resizeObserver = null;
    }
    if (session.onWindowResize) {
        window.removeEventListener("resize", session.onWindowResize);
        window.removeEventListener("scroll", session.onWindowResize, true);
        session.onWindowResize = null;
    }
    if (session.isOpened) {
        try {
            await closeBrowser(id);
        } catch (err) {
            console.error("[browser] closeBrowser failed", err);
        }
    }
    sessions.delete(id);
}

export async function reconcileAliveBrowsers(): Promise<void> {
    try {
        const alive = new Set(await listAliveBrowsers());
        const persisted = new Set(
            useBrowserStore.getState().tabs.map((t) => t.id)
        );
        for (const id of alive) {
            if (!persisted.has(id)) {
                // Stray webview — close it.
                try {
                    await closeBrowser(id);
                } catch {
                    // ignore
                }
            }
        }
    } catch {
        // ignore
    }
}
