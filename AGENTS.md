# AGENTS.md

Operational contract for human and AI agents working in this repo. Keep it short.

**Rule:** if you change architecture, scripts, env vars, ports/auth, folder structure, or developer workflow, update this file in the same change.

---

## Monorepo

- `app/` — Tauri desktop app (React 19 + Vite 7 + TypeScript, Rust host)
- `server/` — Bun + Elysia HTTP server, compiled to a sidecar binary for Tauri

Flow: React UI → HTTP → Bun/Elysia server. In release builds, the Rust host spawns the server as a sidecar.

---

## Package manager

Use `bun` / `bun run` / `bunx`. Do **not** use `npm`, `npx`, `yarn`, or `pnpm`.

---

## Run and build

### Frontend + Tauri (from `app/`)
- `bun run dev` — Vite dev server
- `bun run prod` — `tauri dev` with default config
- `bun run local:dev` — `tauri dev` with `tauri.localdev.json` (separate icon set)
- `bun run build` — TypeScript + Vite build

### Server (from `server/`)
- `bun run start:server` — run on `127.0.0.1:4728` with `--watch` (dev port)
- `bun run build` — compile sidecar to `app/src-tauri/binaries/sidecar-x86_64-pc-windows-msvc.exe`

### Two-port split (intentional)
- **Production / built app** — `http://127.0.0.1:4727`. Rust auto-spawns the sidecar.
- **Local development** — `http://127.0.0.1:4728`. Developer runs `bun run start:server` manually.

`SERVER_BASE_URL` (in `app/src/lib/server-url.ts`) picks the right port via `import.meta.env.DEV`. `VITE_API_URL` overrides everything.

Auth (`Authorization: Basic app:<password>`) is only enforced when `SERVER_PASSWORD` is set in `server/.env`.

---

## Where things live

### Frontend (`app/src/`)
- `routes/` — TanStack Router file-based routes (`routeTree.gen.ts` is generated, don't edit)
- `features/` — feature modules (Zustand stores, hooks, API clients):
  - `server/` — server connection + health polling
  - `conversations/` — conversation store, SSE handling, types
  - `models/`, `permissions/`, `questions/`, `plans/`, `slash-commands/`, `chat-drafts/`, `mcp/`, `stats/`, `context/`, `notifications/`, `hotkeys/`, `right-sidebar/terminals/`
- `components/chat/` — chat UI (`MessageBubble`, `ToolCallCard`, `PermissionCard`, `QuestionCard`, `ContextMeter`, etc.)
- `components/settings/` — settings panels
- `lib/api.ts` — shared HTTP client + auth header

### Tauri host (`app/src-tauri/`)
- `src/lib.rs` — sidecar lifecycle, terminals, badge command
- `src/terminals.rs` — interactive PTYs (`portable-pty`)
- `capabilities/default.json` — Tauri permissions
- `gen/schemas/*` — generated, don't edit

### Server (`server/src/`)
- `index.ts` — CLI entry, CORS/auth, Bun serve
- `app.ts` — Elysia app + readiness guard
- `lib/db.ts` — per-workspace SQLite helper (open / cache / migrate)
- `lib/stats-db.ts` — append-only stats ledger at `~/.agnt/stats.db`
- `modules/`:
  - `conversations/` — conversation CRUD (per-workspace SQLite); `conversation.stream.ts` wires `streamText`; `conversation.prompt.ts` composes the system prompt
  - `conversations/tools/` — agent tool defs + registry (`AGNT_TOOL_DEFS`, `UNGATED_TOOL_NAMES`)
  - `conversations/permissions/` — `buildConversationTools` + `withPermission` gate
  - `conversations/plans/`, `subagents/`, `shell/`, `questions/`, `todos/`
  - `skills/`, `mcp/`, `rules/`, `lsp/`, `stats/`, `models/`, `health/`, `history/`, `settings/`

### Global config / data
- `~/.agnt/settings.json` — global app settings (categories: `hotkeys`, `toolPermissions`, `notifications`, `diagnostics`)
- `~/.agnt/workspaces/<workspaceId>/conversations.db` — per-workspace SQLite
- `~/.agnt/stats.db` — append-only stats ledger (NOT touched by conversation deletion)
- `~/.agnt/plans/plan-<uuid>.md` — plan files
- `~/.agnt/mcp.json` (global) and `<workspace>/.agnt/mcp.json` (project) — MCP server configs
- `~/.agnt/rules/<uuid>.md` — global user rules (one body per file, no frontmatter); appended at the end of the cached system prompt
- Skill discovery roots (later overrides earlier; project always wins): `~/.agnt/skills/`, `~/.agents/skills/`, `~/.claude/skills/`, then the same three under `<workspace>/`

---

## Conventions

- TypeScript strict in `app` and `server`.
- 4-space indentation in app/server source.
- `@/*` path alias to `src/*`.
- Don't edit generated files: `app/src/routeTree.gen.ts`, `app/src-tauri/gen/schemas/*`.
- Keep modules small; avoid hidden global state beyond established stores/registries.
- Don't start the dev server (`bun run dev` etc.) — the user runs it.

---

## Change policy

Before editing: read this file, then read the module(s) you touch end-to-end.

After editing, update this file if you changed any of:
- commands / scripts
- architecture or data flow
- env vars or auth
- ports / URLs
- folder or module ownership
- build / deploy behavior

Add one line under **Maintenance Log**. If nothing in this doc changed, say so explicitly in your summary.

---

## Maintenance Log

Keep compact: one line per entry, latest 10 entries only — collapse older into a single summary line.

- 2026-04-27: Added global Rules system. New `server/src/modules/rules/` (CRUD over `~/.agnt/rules/<uuid>.md`), `/rules` HTTP routes, `buildUserRulesBlock` in `conversation.prompt.ts` appended after the skills block, and a "Rules" Settings panel (`app/src/components/settings/RulesSettings.tsx`) backed by `app/src/features/rules/`. System prompt now has 10 ordered blocks.
- 2026-04-26: Added MCP support — configs at `~/.agnt/mcp.json` (global) and `<workspace>/.agnt/mcp.json` (project); tools exposed as `mcp__<server>__<tool>`; agent mode only.
- 2026-04-26: Added `/` slash commands in chat input — `/agent`, `/plan`, `/ask`, `/bypass` toggle modes; `/init` expands to a prompt; `/<skill>` auto-loads a skill for the turn.
- 2026-04-26: Added per-route chat-input draft persistence (Tiptap doc JSON in localStorage, slot keyed by conversation/workspace).
- 2026-04-26: Auto-compaction now runs inside the SSE stream, also trims `tool_invocations.output_json`, has a deterministic markdown fallback when the summarizer LLM fails, and now also runs on the `/reply` (home create-then-reply) path.
- 2026-04-26: Mid-turn tool-result trim (`prepareStep` in `streamText`) shrinks oversized tool outputs in the in-flight prompt without touching DB rows.
- 2026-04-26: Local-dev Tauri icon split — `app/src-tauri/icons/local/` overrides `bundle.icon` via `tauri.localdev.json` for `bun run local:dev`.
- 2026-04-27: Removed automatic AGENTS.md / CLAUDE.md injection. Deleted `server/src/modules/conversations/repo-instructions.ts`, the `/workspaces/:id/repo-instructions` route, the Repo Instructions settings panel, and the `repoInstructions` slice from the context-meter breakdown. The agent reads repo-level markdown files via `read_file` like any other source now.
- 2026-04-26: Reworked system prompt composition (`conversation.prompt.ts` + `system-context.ts`) — nine ordered blocks (Identity / Communication / Mode / Tool calling / File editing / Long-running commands / Git safety / Environment / Skills).
- 2026-04-25: Soft-archive flow for conversations (`archived_at` column, sidebar archive button + per-workspace popover with restore + permanent-delete).
- 2026-04-25: Real interactive terminals in right sidebar via `portable-pty` (Rust) + xterm.js (frontend); separate from the agent's `shell` tool.
- pre-2026-04-25: Assistant message footer (generation time + model + hover-reveal copy button) with pause-aware clock; initial contract; Codex OAuth/SSE streaming; agent tool framework; context meter + auto-compaction; tool permission system; skills; subagents (`task` tool); ungated `question` / `todo_write` / `write_plan` tools; `write` / `str_replace` / `apply_patch` edit tools; `image_gen`; LSP diagnostics; global stats dashboard; notifications + Windows taskbar badge.

---

## Pre-PR checklist

- [ ] No generated files manually edited
- [ ] Ports / auth / startup assumptions still coherent
- [ ] AGENTS.md updated if workflow / contract changed
- [ ] Health / readiness still accurate
