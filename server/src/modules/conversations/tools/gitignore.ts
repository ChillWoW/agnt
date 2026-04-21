import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { logger } from "../../../lib/logger";

/**
 * Reads the root .gitignore and extracts plain directory-style ignore
 * entries (e.g. "dist/", "/build", "my-output"). Returns a set of
 * directory segment names that the node walker should prune in addition
 * to the built-in IGNORED_DIR_SEGMENTS.
 *
 * This intentionally implements only a subset of gitignore semantics:
 * - plain dir names (`build`) and trailing-slash entries (`build/`)
 * - optional anchoring `/` (we only support top-level anchoring anyway)
 *
 * It skips anything with glob metacharacters, nested paths, or negations.
 * Those cases are handled correctly on the ripgrep path, which IS the
 * preferred path; this helper only needs to cover the cheap & common
 * case ("user added `build/` to .gitignore") in the fallback.
 */
export async function readExtraIgnoredSegments(
    root: string
): Promise<Set<string>> {
    const extra = new Set<string>();
    let raw: string;
    try {
        raw = await readFile(join(root, ".gitignore"), "utf8");
    } catch {
        return extra;
    }
    for (const rawLine of raw.split(/\r?\n/)) {
        let line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;
        if (line.startsWith("!")) continue;
        if (line.startsWith("/")) line = line.slice(1);
        if (line.endsWith("/")) line = line.slice(0, -1);
        if (!line) continue;
        // Reject paths, glob metacharacters, or anything that wouldn't be
        // safe to treat as a bare directory name.
        if (/[\\/*?\[\]{}!]/.test(line)) continue;
        extra.add(line);
    }
    if (extra.size > 0) {
        logger.log("[gitignore] extra ignored segments", {
            count: extra.size
        });
    }
    return extra;
}
