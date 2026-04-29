// Tolerant streaming-JSON helper used by tool blocks whose `input` arrives
// in `tool-input-delta` chunks (write / str_replace / apply_patch). The
// final input is parsed as proper JSON server-side; this file only deals
// with the in-flight partial blob so we can show a live preview while the
// model is still typing.

export interface PartialString {
    value: string;
    complete: boolean;
}

/**
 * Walks a partial JSON object (as streamed by `tool-input-delta` chunks) and
 * returns top-level string-valued fields. Tolerates unterminated strings and
 * truncated input — an unfinished string returns `{ complete: false }` with
 * whatever text was streamed so far. Only the outermost object is considered,
 * so a key like `"path"` nested inside a value won't collide.
 */
export function extractPartialTopLevelStrings(
    json: string
): Record<string, PartialString> {
    const result: Record<string, PartialString> = {};
    let i = 0;
    const n = json.length;

    const skipWs = () => {
        while (i < n && /\s/.test(json[i] ?? "")) i++;
    };

    const readString = (): PartialString => {
        i++;
        let out = "";
        while (i < n) {
            const ch = json[i]!;
            if (ch === "\\") {
                if (i + 1 >= n) return { value: out, complete: false };
                const next = json[i + 1]!;
                if (next === "u") {
                    if (i + 5 >= n) {
                        return { value: out, complete: false };
                    }
                    const hex = json.slice(i + 2, i + 6);
                    if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
                        return { value: out, complete: false };
                    }
                    out += String.fromCharCode(parseInt(hex, 16));
                    i += 6;
                    continue;
                }
                const escapeMap: Record<string, string> = {
                    n: "\n",
                    r: "\r",
                    t: "\t",
                    b: "\b",
                    f: "\f",
                    '"': '"',
                    "\\": "\\",
                    "/": "/"
                };
                out += escapeMap[next] ?? next;
                i += 2;
                continue;
            }
            if (ch === '"') {
                i++;
                return { value: out, complete: true };
            }
            out += ch;
            i++;
        }
        return { value: out, complete: false };
    };

    const skipValueNonString = () => {
        let depth = 0;
        while (i < n) {
            const ch = json[i]!;
            if (depth === 0 && (ch === "," || ch === "}")) return;
            if (ch === "{" || ch === "[") {
                depth++;
                i++;
                continue;
            }
            if (ch === "}" || ch === "]") {
                if (depth === 0) return;
                depth--;
                i++;
                continue;
            }
            if (ch === '"') {
                readString();
                continue;
            }
            i++;
        }
    };

    skipWs();
    if (i >= n || json[i] !== "{") return result;
    i++;

    while (i < n) {
        skipWs();
        if (i >= n) break;
        const ch = json[i];
        if (ch === "}") break;
        if (ch === ",") {
            i++;
            continue;
        }
        if (ch !== '"') break;
        const key = readString();
        if (!key.complete) break;
        skipWs();
        if (i >= n || json[i] !== ":") break;
        i++;
        skipWs();
        if (i >= n) break;
        if (json[i] === '"') {
            const val = readString();
            result[key.value] = val;
            if (!val.complete) break;
        } else {
            skipValueNonString();
        }
    }

    return result;
}
