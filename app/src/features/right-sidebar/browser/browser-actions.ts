import {
    backBrowser,
    evalBrowser,
    forwardBrowser,
    navigateBrowser,
    reloadBrowser,
    stopBrowser
} from "./browser-bridge";
import {
    disposeBrowserSession,
    isBrowserOpened
} from "./browser-session";
import { useBrowserStore } from "./browser-store";
import type { BrowserTabDescriptor } from "./browser-types";

// Resolves an arbitrary URL bar entry into a navigable URL. Bare
// strings without a scheme are treated as Google searches; anything
// that already has a scheme or looks like a host is left alone (with
// `https://` added if a scheme is missing).
export function resolveUrl(input: string): string {
    const trimmed = input.trim();
    if (!trimmed) return "";

    if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
        // already has a scheme (http:, https:, file:, about:, ...)
        return trimmed;
    }

    if (trimmed.startsWith("//")) {
        return `https:${trimmed}`;
    }

    // Heuristic: looks like a host if it contains no whitespace and
    // either has a dot or is `localhost[:port]`.
    const looksLikeHost =
        !/\s/.test(trimmed) &&
        (trimmed.includes(".") ||
            /^localhost(:\d+)?(\/.*)?$/i.test(trimmed));
    if (looksLikeHost) {
        return `https://${trimmed}`;
    }

    return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

export function openNewTab(initialUrl?: string): BrowserTabDescriptor {
    return useBrowserStore.getState().addTab(initialUrl);
}

export async function navigateTab(id: string, url: string): Promise<void> {
    const resolved = resolveUrl(url);
    if (!resolved) return;
    useBrowserStore.getState().setUrl(id, resolved);
    if (isBrowserOpened(id)) {
        await navigateBrowser(id, resolved);
    }
}

export async function backTab(id: string): Promise<void> {
    if (!isBrowserOpened(id)) return;
    await backBrowser(id);
}

export async function forwardTab(id: string): Promise<void> {
    if (!isBrowserOpened(id)) return;
    await forwardBrowser(id);
}

export async function reloadTab(id: string): Promise<void> {
    if (!isBrowserOpened(id)) return;
    await reloadBrowser(id);
}

export async function stopTab(id: string): Promise<void> {
    if (!isBrowserOpened(id)) return;
    await stopBrowser(id);
}

export async function closeTab(id: string): Promise<string | null> {
    const neighbor = useBrowserStore.getState().closeTab(id);
    await disposeBrowserSession(id);
    return neighbor;
}

// ---------------------------------------------------------------------
// Future agent browser-tools seam.
//
// These wrappers are the public surface where future tools (snapshot,
// click, type, screenshot, wait-for-navigation, ...) will plug in.
// They map 1:1 to capabilities reserved in
// `app/src-tauri/assets/browser-preload.js` under
// `window.__agnt_browser__.*`. Today only `evalInTab` is operational
// — `snapshotTab`/`clickRef`/`typeRef` will throw "not implemented"
// until the preload primitives ship.
// ---------------------------------------------------------------------
export async function evalInTab(id: string, js: string): Promise<void> {
    if (!isBrowserOpened(id)) {
        throw new Error("browser tab not opened");
    }
    await evalBrowser(id, js);
}

export async function snapshotTab(id: string): Promise<unknown> {
    await evalInTab(
        id,
        "void window.__agnt_browser__ && window.__agnt_browser__.snapshot()"
    );
    return undefined;
}

export async function clickRef(id: string, ref: string): Promise<void> {
    await evalInTab(
        id,
        `void window.__agnt_browser__ && window.__agnt_browser__.click(${JSON.stringify(ref)})`
    );
}

export async function typeRef(
    id: string,
    ref: string,
    text: string
): Promise<void> {
    await evalInTab(
        id,
        `void window.__agnt_browser__ && window.__agnt_browser__.type(${JSON.stringify(ref)}, ${JSON.stringify(text)})`
    );
}
