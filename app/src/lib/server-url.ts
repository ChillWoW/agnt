// Single source of truth for the sidecar/server URL the frontend talks to.
// Two ports are intentional:
//   • 4727 — production. The Rust host auto-spawns the sidecar on this port
//     during `Builder::setup` in release builds (`app/src-tauri/src/lib.rs`).
//   • 4728 — local development. The developer runs `bun run start:server`
//     from `server/` in a separate terminal so server-side changes hot-reload
//     under `bun --watch`.
// Vite's `import.meta.env.DEV` is `true` for `vite dev` (used by both
// `bun run prod` and `bun run local:dev` via Tauri's `beforeDevCommand`)
// and `false` in built bundles loaded from a Tauri release binary.
const DEV_PORT = 4728;
const PROD_PORT = 4727;
const DEFAULT_BASE_URL = `http://127.0.0.1:${import.meta.env.DEV ? DEV_PORT : PROD_PORT}`;

// `VITE_API_URL` still wins so anyone pointing the app at a remote/staging
// server (or a different local port) can override without touching code.
export const SERVER_BASE_URL = (
    (import.meta.env.VITE_API_URL as string | undefined) ?? DEFAULT_BASE_URL
).replace(/\/$/, "");
