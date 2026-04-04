# AGENTS.md

## Purpose
This is the **operational contract** for human and AI agents working in this repo.

**Non-optional rule:** if you change architecture, runtime behavior, scripts, env vars, ports/auth, folder structure, or developer workflow, you must update this file in the same change.

---

## Monorepo shape
- `app/` — Tauri desktop app (React + Vite + TypeScript frontend, Rust backend shell)
- `server/` — Bun + Elysia HTTP server, compiled to a sidecar binary for Tauri

High-level flow:

```mermaid
graph LR
  UI[React UI in app/src] -->|HTTP| API[Bun/Elysia server]
  Tauri[Rust Tauri host] -->|spawns sidecar| API
  API --> Health[/health, /health/ready]
```

---

## Current stack and key libs

### Frontend (`app/`)
- React 19
- Vite 7
- TanStack Router (file-based, generated route tree)
- Tailwind CSS v4 + `@tailwindcss/vite`
- Zustand present in deps (not used much yet)
- Tauri JS APIs/plugins in deps

### Tauri (`app/src-tauri/`)
- Tauri 2
- Plugins: shell, http, opener, dialog, notification
- Rust side manages sidecar process lifecycle (`start_server`, `stop_server`)

### Server (`server/`)
- Bun runtime
- Elysia framework
- Commander CLI
- Zod in deps

---

## Run and build commands

### Frontend + Tauri
From `app/`:
- `bun run dev` — Vite dev server
- `bun run dev:local` — Vite in `localdev` mode
- `bun run local:dev` — `tauri dev` using `src-tauri/tauri.localdev.json`
- `bun run prod` — `tauri dev` with default config
- `bun run build` — TypeScript + Vite build

### Server
From `server/`:
- `bun run start:server` — run HTTP server on `127.0.0.1:4727` with watch
- `bun run build` — compile sidecar binary to `app/src-tauri/binaries/sidecar-x86_64-pc-windows-msvc.exe`
- `bun run dev` — watch build variant

---

## Important runtime behavior

### Server readiness + health
- `server/src/readiness.ts` gates app routes until server marked ready.
- `GET /health` always returns `{ status: "ok", version }`.
- `GET /health/ready` returns ready status or 503 starting.

### CORS + auth in server
- CORS allows `http://localhost*`, `tauri://localhost`, `http(s)://tauri.localhost`.
- If `SERVER_PASSWORD` is set, Basic auth is required (`app:<password>`).

### Frontend connection monitor
- `app/src/features/server/*` polls `http://127.0.0.1:4727/health` every 3s.
- `waitForServerConnection()` is a global gate used by `app/src/lib/api.ts` before HTTP requests.

### Tauri sidecar lifecycle
- Rust code (`app/src-tauri/src/lib.rs`) can spawn sidecar with random free port and random password via env.
- On window close, sidecar child process is killed.

---

## Known integration caveat (verify before changing)
There are currently two server access patterns in code:
1. Frontend monitor/API default to fixed `127.0.0.1:4727` (optional auth via Vite env), and
2. Tauri Rust sidecar launcher can use a random port + generated password.

When touching networking/startup/auth, explicitly decide which mode is canonical and keep all layers aligned.

---

## Code conventions to preserve
- TypeScript strict mode is enabled in both `app` and `server`.
- Use `@/*` path alias to `src/*` where already used.
- Follow local file formatting/style (current code prefers 4-space indentation in app/server source).
- Keep modules small and explicit; avoid hidden global state beyond established server connection state module.
- Do not edit generated files manually:
  - `app/src/routeTree.gen.ts` (TanStack generated)
  - `app/src-tauri/gen/schemas/*` (Tauri generated)

---

## Files/folders agents should know first
- `app/src/features/server/` — frontend server connection state, polling, wait gate
- `app/src/lib/api.ts` — shared HTTP client, auth header/env resolution
- `app/src/routes/` — route components
- `app/src-tauri/src/lib.rs` — sidecar startup/shutdown and Tauri commands
- `app/src-tauri/capabilities/default.json` — Tauri permissions
- `server/src/index.ts` — CLI server entry, CORS/auth wrapping, Bun serve
- `server/src/app.ts` — Elysia app and readiness guard
- `server/src/modules/health/*` — health/readiness endpoints
- `server/build.ts` — sidecar compile script + `.env` define injection

---

## Change policy for agents (must follow)
Before editing:
1. Read this file.
2. Read the module(s) you touch end-to-end.
3. Check for generated files and avoid direct edits.

After editing (same change):
1. Update `AGENTS.md` if any of these changed:
   - commands/scripts
   - architecture/data flow
   - env vars or auth model
   - ports/URLs
   - folder/module ownership
   - build/deploy behavior
2. Add a short entry under **Maintenance Log**.

If nothing in this doc changed, state that explicitly in your summary.

---

## Maintenance Log
- 2026-04-04: Initial AGENTS.md created from repository inspection (app + server + tauri + sidecar workflow). 

---

## Quick pre-PR checklist
- [ ] No generated files manually edited
- [ ] Runtime mode assumptions (port/auth/startup) still coherent
- [ ] AGENTS.md updated if workflow/contracts changed
- [ ] Health/readiness behavior remains accurate
- [ ] New env vars documented here
- [ ] Commands in this file still run as documented
