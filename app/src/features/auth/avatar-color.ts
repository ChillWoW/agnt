/**
 * Deterministic per-account avatar color.
 *
 * Hashes the input (typically `accountId` or `email`) into a stable hue and
 * returns inline styles for a small circular avatar tile. Same input always
 * yields the same hue across surfaces (sidebar popover, settings panel,
 * chat-input footer indicator), so users can recognize an account by color
 * without reading the email.
 *
 * The lightness/saturation are tuned for the dark UI: medium-saturation,
 * mid-low lightness so the white initial reads cleanly without glare.
 */

export function hashHueFromString(input: string): number {
    if (input.length === 0) return 210;
    let hash = 0;
    for (let i = 0; i < input.length; i += 1) {
        hash = (hash * 31 + input.charCodeAt(i)) | 0;
    }
    return Math.abs(hash) % 360;
}

export type AvatarStyle = {
    background: string;
    color: string;
    boxShadow: string;
};

export function accountAvatarStyle(seed: string): AvatarStyle {
    const hue = hashHueFromString(seed);
    const start = `hsl(${hue}, 62%, 38%)`;
    const end = `hsl(${(hue + 32) % 360}, 70%, 28%)`;
    return {
        background: `linear-gradient(135deg, ${start}, ${end})`,
        color: "rgba(255, 255, 255, 0.95)",
        boxShadow: `0 0 0 1px hsl(${hue}, 50%, 22%) inset`
    };
}

/** Pull the first character usable as an avatar initial (uppercase). */
export function accountInitial(input: {
    name?: string | null;
    email?: string | null;
    label?: string | null;
    accountId?: string | null;
}): string {
    const candidates = [input.label, input.name, input.email, input.accountId];
    for (const candidate of candidates) {
        if (typeof candidate === "string" && candidate.trim().length > 0) {
            const ch = candidate.trim().charAt(0);
            return ch.toUpperCase();
        }
    }
    return "?";
}
