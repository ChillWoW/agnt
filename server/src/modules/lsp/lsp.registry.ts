import { resolve } from "node:path";
import { logger } from "../../lib/logger";
import { TypeScriptLspProvider } from "./lsp.typescript";

// ─── Per-workspace LSP registry ───────────────────────────────────────────────
//
// Maintains one `TypeScriptLspProvider` per workspace root. Providers are
// lazily created on first use and kept alive so subsequent requests don't pay
// the warm-up cost. Shutdown paths are expected to call `disposeAll()` from
// `server/src/index.ts` so orphaned language server children are reaped.

interface RegistryEntry {
    provider: TypeScriptLspProvider;
    startedAt: number;
}

const entries = new Map<string, RegistryEntry>();

function normalizeKey(workspacePath: string): string {
    return resolve(workspacePath);
}

export function getTypeScriptProvider(
    workspacePath: string
): TypeScriptLspProvider {
    const key = normalizeKey(workspacePath);
    const existing = entries.get(key);
    if (existing) return existing.provider;
    const provider = new TypeScriptLspProvider({ workspacePath: key });
    entries.set(key, { provider, startedAt: Date.now() });
    logger.log("[lsp:registry] created TS provider", { workspacePath: key });
    return provider;
}

export async function disposeWorkspace(workspacePath: string): Promise<void> {
    const key = normalizeKey(workspacePath);
    const entry = entries.get(key);
    if (!entry) return;
    entries.delete(key);
    try {
        await entry.provider.dispose();
    } catch (error) {
        logger.error("[lsp:registry] dispose error", { workspacePath, error });
    }
}

export async function disposeAll(): Promise<void> {
    const all = Array.from(entries.values());
    entries.clear();
    await Promise.all(
        all.map(async (entry) => {
            try {
                await entry.provider.dispose();
            } catch (error) {
                logger.error("[lsp:registry] disposeAll error", error);
            }
        })
    );
}
