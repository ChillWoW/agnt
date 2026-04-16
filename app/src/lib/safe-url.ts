const SAFE_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);
const SAFE_IMAGE_PROTOCOLS = new Set(["http:", "https:", "data:", "blob:"]);
const LOCAL_HOSTNAMES = new Set([
    "localhost",
    "127.0.0.1",
    "::1",
    "tauri.localhost"
]);

export interface SafeImageUrl {
    url: string;
    autoLoad: boolean;
}

function resolveUrl(input: string): URL | null {
    if (typeof window === "undefined") {
        return null;
    }

    try {
        return new URL(input, window.location.origin);
    } catch {
        return null;
    }
}

function isLocalUrl(url: URL) {
    return LOCAL_HOSTNAMES.has(url.hostname);
}

export function normalizeSafeLinkUrl(href?: string | null): string | null {
    if (!href) {
        return null;
    }

    const normalizedHref = href.trim();

    if (!normalizedHref) {
        return null;
    }

    const url = resolveUrl(normalizedHref);

    if (!url || !SAFE_LINK_PROTOCOLS.has(url.protocol)) {
        return null;
    }

    return url.toString();
}

export function normalizeSafeImageUrl(src?: string | null): SafeImageUrl | null {
    if (!src) {
        return null;
    }

    const normalizedSrc = src.trim();

    if (!normalizedSrc) {
        return null;
    }

    const url = resolveUrl(normalizedSrc);

    if (!url || !SAFE_IMAGE_PROTOCOLS.has(url.protocol)) {
        return null;
    }

    const autoLoad =
        url.protocol === "data:" ||
        url.protocol === "blob:" ||
        isLocalUrl(url);

    return {
        url: url.toString(),
        autoLoad
    };
}
