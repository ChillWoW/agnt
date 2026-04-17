const TEXT_MIME_PATTERNS = [
    /^text\//,
    /\+json$/,
    /\+xml$/,
    /\+yaml$/,
    /\/json$/,
    /\/xml$/,
    /\/javascript$/,
    /\/typescript$/,
    /\/yaml$/,
    /\/toml$/,
    /\/csv$/,
    /\/markdown$/,
    /\/x-sh$/,
    /\/x-shellscript$/,
    /\/x-python$/
];

export function isKnownTextMime(mime: string): boolean {
    const normalized = mime.toLowerCase();
    return TEXT_MIME_PATTERNS.some((re) => re.test(normalized));
}

export function looksLikeUtf8Text(bytes: Uint8Array): boolean {
    const sample = bytes.subarray(0, Math.min(bytes.byteLength, 4096));

    for (const byte of sample) {
        if (byte === 0) return false;
        if (byte === 9 || byte === 10 || byte === 13) continue;
        if (byte < 32) return false;
    }

    try {
        new TextDecoder("utf-8", { fatal: true }).decode(sample);
    } catch {
        return false;
    }

    return true;
}
