export async function openExternalUrl(url: string) {
    try {
        const opener = (await import("@tauri-apps/plugin-opener")) as Record<
            string,
            unknown
        >;
        const openUrl = opener.openUrl;

        if (typeof openUrl === "function") {
            await openUrl(url);
            return;
        }
    } catch {
        // Fall through to browser open.
    }

    window.open(url, "_blank", "noopener,noreferrer");
}
