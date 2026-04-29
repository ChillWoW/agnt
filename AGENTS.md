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
  - `split-panes/` — global split-pane layout (1–3 conversations side-by-side, freely mixing workspaces). Persisted via Zustand `persist` to `agnt:split-panes:v2`. `pane-scope.tsx` exposes `usePaneScope` / `usePaneWorkspaceId` so nested chat components resolve the *pane's* workspace, not the active one. The conversation-store keeps a `workspaceIdByConversationId` map so the URL-bound primary pane can find its owning workspace.
  - `models/`, `permissions/`, `questions/`, `plans/`, `slash-commands/`, `chat-drafts/`, `mcp/`, `stats/`, `context/`, `notifications/`, `hotkeys/`, `right-sidebar/terminals/`, `right-sidebar/browser/`
- `components/chat/` — chat UI (`MessageBubble`, `ToolCallCard`, `PermissionCard`, `QuestionCard`, `ContextMeter`, etc.). `ToolCallCard.tsx` is a thin dispatcher; per-tool block components live in `components/chat/tool-cards/<ToolName>Block.tsx`, with the shared `ToolBlock` primitive + formatters / partial-JSON parser / `TerminalPane` / `PostEditDiagnostics` in `components/chat/tool-cards/shared/`.
- `components/settings/` — settings panels
- `lib/api.ts` — shared HTTP client + auth header

### Tauri host (`app/src-tauri/`)
- `src/lib.rs` — sidecar lifecycle, terminals, browser tabs, badge command
- `src/terminals.rs` — interactive PTYs (`portable-pty`)
- `src/browser.rs` — child-webview-per-tab browser. `BrowserState` keeps a `HashMap<id, Webview>`; commands `browser_open`/`navigate`/`back`/`forward`/`reload`/`stop`/`hard_reload`/`clear_cookies`/`clear_cache`/`get_url`/`set_bounds`/`set_visible`/`close`/`list_alive`/`eval`/`meta_report` and events `browser://navigated`/`title`/`favicon`/`load-state`/`url-report`. Requires `tauri = { features = ["unstable"] }` for `Window::add_child` + `WebviewBuilder`. `clear_cookies` iterates `webview.cookies()` + `delete_cookie`; `clear_cache` snapshots cookies, calls `clear_all_browsing_data` (which is the only granularity Tauri exposes), then re-sets the cookies — note this still wipes localStorage / IndexedDB. All tabs share a single profile dir at `~/.agnt/browser-profile/`.
- `assets/browser-preload.js` — initialization script injected into every browser-tab webview. Reports title/favicon/url back to the host and reserves `window.__agnt_browser__` (snapshot/findByRef/click/type/screenshot stubs) as the seam future agent browser-tools fill in.
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
  - `skills/`, `mcp/`, `rules/`, `memories/`, `lsp/`, `stats/`, `models/`, `health/`, `history/`, `settings/`

### Global config / data
- `~/.agnt/settings.json` — global app settings (`general`, `hotkeys`, `toolPermissions`, `notifications`, `diagnostics`). `general.restrictToolsToWorkspace` (default `true`) gates the workspace-boundary check in `resolveWorkspacePath`.
- `~/.agnt/workspaces.json` — workspace registry. The "Home" workspace is reserved (id `00000000-0000-4000-8000-000000000001`), always present at index 0, points at `os.homedir()`, cannot be removed.
- `~/.agnt/workspaces/<workspaceId>/conversations.db` — per-workspace SQLite
- `~/.agnt/stats.db` — append-only stats ledger (NOT touched by conversation deletion)
- `~/.agnt/plans/plan-<uuid>.md` — plan files
- `~/.agnt/browser-profile/` — shared cookie/session profile for all right-sidebar browser tabs (one global profile)
- `~/.agnt/mcp.json` (global) and `<workspace>/.agnt/mcp.json` (project) — MCP server configs
- `~/.agnt/rules/<uuid>.md` — global user rules (one body per file, no frontmatter); appended at the end of the cached system prompt
- `~/.agnt/memories/<uuid>.md` — global LLM-managed memories (`# <title>` + body). Written/read/deleted ONLY through `memory_write` / `memory_read` / `memory_delete` tools. Only the title index is auto-injected into the system prompt; bodies fetched on demand.
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

- 2026-04-30: Right-sidebar browser tabs — global multi-tab native-webview browser embedded in the right panel. New Rust module `app/src-tauri/src/browser.rs` (BrowserState + open/navigate/back/forward/reload/stop/set_bounds/set_visible/close/list_alive/eval/meta_report commands; emits `browser://navigated`/`title`/`favicon`/`load-state`/`url-report`); requires `tauri` feature `unstable` for `Window::add_child`+`WebviewBuilder`. Preload script `app/src-tauri/assets/browser-preload.js` reports title/favicon/url and reserves `window.__agnt_browser__` (snapshot/findByRef/click/type/screenshot stubs) — the seam future agent browser-tools will fill in. Shared cookie profile at `~/.agnt/browser-profile/`. Frontend `app/src/features/right-sidebar/browser/` (zustand persist, bridge fan-out, ResizeObserver+rAF bounds sync, NewTabPage + chrome bar). `useOpenedFilesStore.active` extended with `{kind:"browser", id}`; browser tabs render as pills in the top strip alongside file pills (per user request); GlobeIcon click and `Ctrl+Alt+B` open a new tab (Chrome-style); webview is hidden via `setBrowserVisible` when sidebar collapses or settings open.
- 2026-04-29: Eager file `@`-mention loads — file-typed `@path` mentions now invoke `read_file` server-side at stream-start (mirrors the slash-skill flow): contents inlined as a trailing per-turn `<active_reads>` system block AND a synthetic `read_file` tool invocation persisted on the assistant message + emitted via SSE so the chat shows a real ReadFileBlock card. Directory mentions still go through `buildMentionsInstructionBlock` (now dir-only). Wired through `streamConversationReply` / `streamEditAndRegenerate` (passes incoming `mentions`), `streamReplyToLastMessage` / `streamRegenerateLastTurn` (re-parses from latest user message text).
- 2026-04-29: Message branching for the latest turn — new schema cols `messages.branch_group_id`/`branch_index` + `conversations.active_branch_group_id`/`active_branch_index` (idempotent migrations); history queries filter via `branchFilteredMessagesClause`; routes `POST .../regenerate` `/edit-and-regenerate` `/switch-branch`; SSE `branch-info` event; UI `BranchNavigator` + `MessageEditor` + edit-pencil/regenerate icons on latest user/assistant; sealing on next user prompt DELETEs non-active siblings.
- 2026-04-29: Fixed default-model drift where UI showed `gpt-5.5` but server's hardcoded `DEFAULT_MODEL = "gpt-5.4-mini"` was used as fallback everywhere. Added `getDefaultModelId()` in `models.service.ts` (mirrors UI: first `status: "recommended"` entry); subagent defaults intentionally untouched.
- 2026-04-29: Wired `toast` API into existing CRUD flows (workspace add/remove; conversation archive+Undo / rename / pin / restore / delete; stream errors; home-route createConversation; rules CRUD; MCP CRUD+refresh; plan build; settings update; message-copy fallback; server-connection toaster). Skipped where inline error UI already exists.
- 2026-04-29: Added `react-hot-toast` + custom `toast` API (`app/src/components/ui/Toast.tsx`) — variants `success`/`error`/`info`/`loading`, structured `{title, description?, icon?, action?, dismissible?}` payloads, `toast.promise`; mounted once via `<AppToaster>` in `__root.tsx`.
- 2026-04-29: Shrank inline `shell`/`await_shell` output budget fed to the model from 200K→25K chars (`MAX_INLINE_OUTPUT_CHARS`); `truncateForModel` keeps ~4K head + ~21K tail with a middle marker. Rolling buffer + persisted log unchanged.
- 2026-04-29: Split `ToolCallCard.tsx` (~3000→~95 lines) into per-tool blocks under `components/chat/tool-cards/<Name>Block.tsx`; shared primitives in `tool-cards/shared/` (`ToolBlock`, `format.ts`, `partial-json.ts`, `PostEditDiagnostics`, `TerminalPane`). Existing `ToolBlock` import path preserved.
- 2026-04-29: Conversation pinning — nullable `conversations.pinned_at` column + index; `/pin` and `/unpin` routes; archive auto-clears pin; sidebar global "Pinned" group across all workspaces (eager-loads every workspace); per-row hover pin button + context menu; collapse state persisted in left-sidebar store.
- 2026-04-29: Always-present "Home" workspace pinned to OS user home — reserved id `00000000-0000-4000-8000-000000000001`, seeded by `ensureHomeWorkspace` on registry load, refreshes path to `os.homedir()`, locked to index 0, not draggable, "Close workspace" hidden, server `removeWorkspace` rejects.
- pre-2026-04-29: "Worked for Hh Mm Ss" collapse pill (`WorkedSummary.tsx`); cross-workspace sidebar conv-open fix (active-workspace flip before navigate); Alt+digit pane focus switch; Early-Stop discards in-flight prompt; live context meter during turn; server-driven Stop preserves duration+cost; `general` settings category + `restrictToolsToWorkspace`; sidebar workspace-row right-click ContextMenu; sticky chat-input placeholder fix; per-conversation prompt queue; per-turn cost estimate in footer; refreshed `/models` catalog with pricing tiers; split chat panes (1–3 side-by-side) with persisted store + drag-drop + pane-scoped hotkeys; global LLM memory system (ungated `memory_write`/`memory_read`/`memory_delete`, `~/.agnt/memories/`); global Rules system (`~/.agnt/rules/`, `/rules` routes, settings panel); removed auto AGENTS.md/CLAUDE.md injection; MCP via global+project `mcp.json` (`mcp__<server>__<tool>`, agent mode only); `/` slash commands; per-route chat-input draft persistence; auto-compaction inside SSE stream; mid-turn tool-result trim via `prepareStep`; local-dev Tauri icon split; assistant message footer w/ pause-aware clock; initial contract; Codex OAuth/SSE streaming; agent tool framework; context meter + auto-compaction; tool permission system; skills; subagents (`task` tool); ungated `question`/`todo_write`/`write_plan` tools; `write`/`str_replace`/`apply_patch` edit tools; `image_gen`; LSP diagnostics; global stats dashboard; notifications + Windows taskbar badge; soft-archive flow; real PTYs in right sidebar via `portable-pty`+xterm.js (separate from the agent `shell` tool); 9-block system prompt composition.

---

## Pre-PR checklist

- [ ] No generated files manually edited
- [ ] Ports / auth / startup assumptions still coherent
- [ ] AGENTS.md updated if workflow / contract changed
- [ ] Health / readiness still accurate
