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
- `bun:sqlite` for per-workspace conversation storage

---

## Package manager and CLI policy
- Use `bun`/`bun run` for dependency management and scripts.
- Use `bunx` for one-off CLIs.
- Do not use `npm`, `npx`, `yarn`, or `pnpm` commands in this repo unless a future change explicitly documents an exception here.

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

### Conversation storage (SQLite)
- Each workspace has a SQLite database at `~/.agnt/workspaces/<workspaceId>/conversations.db`.
- Tables: `conversations` (id, title, created_at, updated_at), `messages` (id, conversation_id, role, content, created_at), `state_entries` (latest workspace/conversation key-value state), `history_entries` (append-only workspace/conversation state history), and `tool_invocations` (id, message_id, tool_name, input_json, output_json, error, status, created_at) linked to assistant messages with cascade delete.
- `server/src/lib/db.ts` manages per-workspace DB instances with caching and auto-migration.
- Conversations are created lazily on first user message.
- Active conversation streams can be cancelled from the frontend stop button; the frontend aborts the HTTP request, the server forwards `request.signal` into AI SDK `streamText`, and partial assistant text is persisted while empty aborted placeholders are removed.
- Workspace-level and conversation-level metadata/history are exposed under `/workspaces/:id/state|history` and `/workspaces/:id/conversations/:conversationId/state|history`, with `state/effective` providing workspace defaults merged with conversation overrides.
- `GET /models` returns the frontend model catalog used by the chat input selector.
- Conversation streaming resolves model settings from effective state keys: `activeModel`/`model`, `reasoningEffort`/`effort`, and `fastMode`; fast mode maps to OpenAI priority processing when the selected model supports it.

### Agent tools
- The assistant can call tools defined in `server/src/modules/conversations/tools/`. Registry: `server/src/modules/conversations/tools/index.ts` exports `AGNT_TOOLS`.
- `streamText` in `conversation.stream.ts` passes `AGNT_TOOLS` and `stopWhen: stepCountIs(5)`, allowing the model to call tools and then continue generating.
- Tool invocations are persisted in `tool_invocations`: a row is inserted on `tool-call` (status `pending`) and updated on `tool-result` (`success`) / `tool-error` (`error`). Pending rows are marked `error` when the stream aborts or errors.
- SSE protocol adds `tool-call` and `tool-result` events. Each carries `messageId` so the frontend attaches them to the right assistant message. `Message.tool_invocations` is now part of the conversation fetch payload.
- Current tool set: `read_file(path, maxBytes?)` — reads a utf-8 file by absolute path, rejects binary (NUL-byte scan), default 256KB cap, hard cap 1MB. Located at `server/src/modules/conversations/tools/read-file.ts`.
- Frontend renders tool calls as `ToolCallCard` (`app/src/components/chat/ToolCallCard.tsx`) inside the assistant bubble: collapsed summary (tool name + input preview + status), expandable to show full input/output JSON.

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
- `server/src/modules/conversations/*` — conversation CRUD (SQLite-backed, per-workspace)
- `server/src/modules/conversations/tools/*` — agent tool definitions + registry; `conversation.stream.ts` wires them into `streamText`
- `server/src/modules/history/*` — workspace/conversation metadata state snapshots + append-only history
- `server/src/modules/models/*` — model catalog served to the frontend selector
- `server/src/lib/db.ts` — per-workspace SQLite DB helper (open/cache/migrate)
- `server/build.ts` — sidecar compile script + `.env` define injection
- `app/src/features/hotkeys/` — hotkey system (store, provider, useHotkey hook, combo utils, shortcut display)
- `app/src/features/conversations/` — conversation store, API client, types (Zustand)
- `app/src/features/models/` — model catalog fetch + workspace/conversation model selection state sync
- `app/src/components/ui/Tooltip.tsx` — base Tooltip + KeybindTooltip components

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
Keep this section compact to avoid context bloat:
- One line per entry.
- Keep only the latest 10 entries; collapse older history into a single summary line when needed.

- 2026-04-04: Initial AGENTS.md created from repository inspection (app + server + tauri + sidecar workflow).
- 2026-04-04: Added explicit package-manager policy: use `bun`/`bunx`; do not use `npm`/`npx` by default.
- 2026-04-13: Added `app/src/features/hotkeys/` module (Zustand store, provider, useHotkey hook, combo utils, HotkeyShortcut). Added `Tooltip` and `KeybindTooltip` to `app/src/components/ui/`. Added `HotkeySettings` to settings types/store.
- 2026-04-14: Added workspace conversations feature. Server: `server/src/lib/db.ts` (per-workspace SQLite via `bun:sqlite`), `server/src/modules/conversations/` (types, service, routes). Frontend: `app/src/features/conversations/` (store, api, types), `/conversations/$conversationId` route, grouped sidebar with expandable workspace conversations, New Agent button wired to Ctrl+N.
- 2026-04-14: Added Codex OAuth + SSE streaming. Server: `server/src/lib/agnt-home.ts`, `server/src/modules/auth/` (PKCE OAuth, token storage at `~/.agnt/auth.json`, `/auth` routes), `server/src/modules/conversations/codex-client.ts` + `conversation.sse.ts` + `conversation.stream.ts` (AI SDK streamText via `chatgpt.com/backend-api/codex`), added `/stream` and `/reply` endpoints. Frontend: `app/src/features/auth/` (Zustand store, bootstrap, API client), `CodexSettings` in settings panel, SSE stream consumer in conversation store. Server deps added: `ai`, `@ai-sdk/openai`.
- 2026-04-15: Wired conversation stop-generation end-to-end. Frontend `ChatInput` stop action now aborts the in-flight stream request via Zustand; server conversation streaming now forwards `request.signal` into AI SDK `streamText` and persists partial aborted assistant output.
- 2026-04-15: Added per-workspace and per-conversation state/history persistence. Server stores latest key-value snapshots plus append-only history in SQLite, exposes `/workspaces/:id/state|history` + conversation equivalents, and conversation streaming now resolves saved `activeModel`/`model` from effective state; frontend now has typed history API helpers in `app/src/features/history/`.
- 2026-04-15: Added model catalog + chat input model selector. Server exposes `/models` and now applies effective `activeModel`/`reasoningEffort`/`fastMode` state to Codex requests (priority processing for fast mode); frontend adds `app/src/features/models/` and a chat toolbar popover for model, reasoning, speed, and hover pricing details.
- 2026-04-16: Added agent tool framework and first tool `read_file`. Server: `server/src/modules/conversations/tools/` with `read-file.ts` + registry, `conversation.stream.ts` passes tools + `stopWhen: stepCountIs(5)`, new `tool_invocations` SQLite table, new SSE events `tool-call`/`tool-result` carrying `messageId`, `getConversation` loads invocations into `Message.tool_invocations`. Frontend: extended `Message` type, store handles tool SSE events, new `ToolCallCard` component rendered inside `MessageBubble`.

---

## Quick pre-PR checklist
- [ ] No generated files manually edited
- [ ] Runtime mode assumptions (port/auth/startup) still coherent
- [ ] AGENTS.md updated if workflow/contracts changed
- [ ] Health/readiness behavior remains accurate
- [ ] New env vars documented here
- [ ] Commands in this file still run as documented
