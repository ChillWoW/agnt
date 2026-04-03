/**
 * Build script that reads .env and injects values as --define flags,
 * so they get embedded into the compiled Bun binary (bun build --compile
 * does NOT auto-load .env files at runtime).
 */
import { $ } from "bun";

const isDev = process.argv.includes("--dev");
const ENV_FILE = ".env";
const defines: string[] = [];

if (await Bun.file(ENV_FILE).exists()) {
    const content = await Bun.file(ENV_FILE).text();
    for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx > 0) {
            const key = trimmed.slice(0, eqIdx).trim();
            const value = trimmed.slice(eqIdx + 1).trim();
            defines.push("--define", `process.env.${key}=${JSON.stringify(value)}`);
        }
    }
    console.log(`[build] Injecting ${defines.length / 2} env vars from ${ENV_FILE}`);
} else {
    console.warn(`[build] No ${ENV_FILE} found — env vars will not be embedded`);
}

const extraFlags = isDev ? [] : ["--minify"];
const watchFlag = isDev ? ["--watch"] : [];

await $`bun build --compile --target bun-windows-x64 ${extraFlags} ${defines} ./src/index.ts --outfile ../app/src-tauri/binaries/sidecar-x86_64-pc-windows-msvc.exe ${watchFlag}`;
