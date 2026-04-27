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
  - `split-panes/` — per-workspace split-pane layout (1–3 conversations side-by-side); persisted via Zustand `persist` to `agnt:split-panes:v1`
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
  - `skills/`, `mcp/`, `rules/`, `memories/`, `lsp/`, `stats/`, `models/`, `health/`, `history/`, `settings/`

### Global config / data
- `~/.agnt/settings.json` — global app settings (categories: `general`, `hotkeys`, `toolPermissions`, `notifications`, `diagnostics`). `general.restrictToolsToWorkspace` (default `true`) gates the workspace-boundary check in `resolveWorkspacePath`; flip off to let glob/grep/write/str_replace/apply_patch/shell/diagnostics accept absolute paths anywhere on disk.
- `~/.agnt/workspaces/<workspaceId>/conversations.db` — per-workspace SQLite
- `~/.agnt/stats.db` — append-only stats ledger (NOT touched by conversation deletion)
- `~/.agnt/plans/plan-<uuid>.md` — plan files
- `~/.agnt/mcp.json` (global) and `<workspace>/.agnt/mcp.json` (project) — MCP server configs
- `~/.agnt/rules/<uuid>.md` — global user rules (one body per file, no frontmatter); appended at the end of the cached system prompt
- `~/.agnt/memories/<uuid>.md` — global LLM-managed memories (titled markdown notes; first line is `# <title>`, rest is body). Written/read/deleted ONLY through the `memory_write` / `memory_read` / `memory_delete` tools — there is no HTTP route or settings UI. Only the title index is auto-injected into the system prompt; bodies are fetched on demand.
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

- 2026-04-28: Added "Worked for Hh Mm Ss" collapse pill. New `app/src/components/chat/WorkedSummary.tsx` stacks every reasoning block AND every tool call from a finished assistant turn behind a single click-to-expand row showing the wall-clock span of that work; expanded body re-renders the original `ThinkingBlock`s and `ToolCallCard`s in their stream order so each item keeps its own per-card collapse and tool-specific UI. `MessageBubble` (`app/src/components/chat/MessageBubble.tsx`) gates the collapse on `!message.isStreaming` so live progress is still visible during a turn — the stack only forms once the SSE `finish`/`abort` lands. Pill duration prefers the server-persisted `generation_duration_ms` (already pause-aware for permission/question waits, matches the footer) and falls back to first-entry → now for legacy rows. Detail row counts thoughts/tools and surfaces failed-tool count.
- 2026-04-27: Fixed "Conversation not found" when clicking a sidebar conversation in a non-active workspace. Conversations live in per-workspace SQLite (`~/.agnt/workspaces/<id>/conversations.db`), so `loadConversation(activeWorkspaceId, conversationId)` 404s when the route mounts before the active workspace switches. `WorkspaceConversations.handleOpen` (`app/src/features/left-sidebar/sidebar.tsx`) and `WorkspaceArchivedList`'s click/keyboard handler now call `useWorkspaceStore.setActive(workspaceId)` first when the clicked workspace isn't already active, then navigate. `setActive` (`app/src/features/workspaces/workspace-store.ts`) also flips `activeWorkspaceId` optimistically before the server round-trip so the route mounts with the correct workspace id without waiting on the API.
- 2026-04-27: Alt+<digit> switches the focused split pane (Alt+1 → primary, Alt+2 → first secondary, Alt+3 → second secondary). Implemented as a plain `keydown` listener inside `app/src/components/layout/SplitPaneArea.tsx` — deliberately NOT registered through `useHotkey`/`hotkeys-store` so it isn't user-remappable and doesn't show up in the hotkey settings. Only active while a split is visible (`totalPanes > 1`); in single-pane mode the listener is detached so Alt+digit isn't swallowed. Uses `event.code` (`Digit1`..`Digit9`) instead of `event.key` so it works regardless of keyboard layout / Opt-modified macOS characters; calls `preventDefault` only when it actually maps to a visible pane and updates `setFocusedPaneIndex` (which already drives the focus accent and pane-scoped hotkey routing).
- 2026-04-27: Early-Stop discards the in-flight prompt. `POST /workspaces/:id/conversations/:conversationId/stop` now accepts `{ discardUserMessage: boolean }`; the cancellation registry in `server/src/modules/conversations/conversation.stream.ts` carries the `userMsgId` + `assistantMsgId` for the in-flight turn so the route handler can DELETE both rows (the empty assistant placeholder is pre-empted in the same handler to avoid racing the stream's own `onAbort` cleanup), and falls through to `deleteConversation` when no `user`/`assistant` rows remain (brand-new conversation case). Client `stopGeneration` (`app/src/features/conversations/conversation-store.ts`) takes `{ discardUserMessage }`, mirrors the server-side row + conversation deletion locally, and returns `{ stopped, discardedUserMessage, conversationDeleted }`. `ConversationPane` detects "Planning next moves" (assistant placeholder still empty) on Stop, calls `stopGeneration` with the discard flag, writes the user prompt back as a `chat-drafts` snapshot, and either bumps the new `restoreEpoch` (existing conversation — `ChatInput` listens to the per-slot epoch and re-hydrates the live editor without a remount) or navigates to `/` after seeding the home draft (deleted conversation case).
- 2026-04-27: Live context meter during a turn. SSE handler in `app/src/features/conversations/conversation-store.ts` now calls `bumpContextRefresh(conversationId)` on `user-message` and `tool-result` (server has already INSERT/UPDATEd the row before emitting either, so a fresh `/context` fetch picks up the new tokens). `useContextMeter` (`app/src/features/context/use-context-meter.ts`) trails each bump by 150ms to coalesce burst tool completions into a single fetch and aborts in-flight stale fetches via `AbortController`; `fetchContextSummary` (`context-api.ts`) accepts an optional `AbortSignal`. Previously the meter only re-fetched on `finish`/`abort`/`compacted`, so tool calls didn't show up until the whole turn ended.
- 2026-04-27: Server-driven Stop preserves duration + cost. New `POST /workspaces/:id/conversations/:conversationId/stop` route + `cancelConversationStream` registry in `server/src/modules/conversations/conversation.stream.ts` (per-conversation `AbortController` map, merged with the inbound request signal via `attachStreamCancellation`). `streamText`'s `onAbort` now aggregates token usage across completed steps, persists tokens to `messages` and the stats ledger, and `lastUsage` rides the outgoing `abort` SSE event alongside model id + generation duration; the catch-path also emits the same event so AbortError throws aren't a black hole. Client `cancelStream` (`app/src/features/conversations/conversation-api.ts`), new `streamWorkspaceById` map, and rewritten `stopGeneration` POST `/stop` instead of dropping the local fetch (5s fallback to local abort if the server is wedged); the `abort` SSE handler now applies `usage` to the streaming message and bumps the context refresh token. `MessageFooter` keeps showing "Xs - model - ~$Y.YY" after Stop the same way it does on natural finish.
- 2026-04-27: Added `general` settings category with `restrictToolsToWorkspace` (default `true`). New `generalSettingsSchema` in `server/src/modules/settings/settings.types.ts`, `normalizeSettings` updated, and `resolveWorkspacePath` (`server/src/modules/conversations/tools/workspace-path.ts`) now reads the setting fresh per call — when off, the boundary check is skipped (so glob/grep/write/str_replace/apply_patch/shell/diagnostics accept absolute paths anywhere on disk; `read_file` was already permissive). Frontend mirrors the schema in `app/src/typings/settings.ts` + store normalizer, and a new `GeneralSettings` panel (`app/src/components/settings/GeneralSettings.tsx`) is registered first in `settingsCategories` (sidebar picks it up automatically).
- 2026-04-27: Sidebar workspace row UX — replaced the `...` dot-menu (`DotsThreeIcon`) with a right-click `ContextMenu` (Base UI's `BaseContextMenu`) on each `WorkspaceRow` in `app/src/features/left-sidebar/sidebar.tsx`. Items now live in the context menu: New agent, View archived (still opens the right-side `Popover` anchored via the same zero-size `PopoverTrigger`), and Close workspace (destructive). The `+` New Agent button stays on the right of the workspace name (hover-revealed via `group-hover:opacity-100`); only the dot-menu trigger was removed. No new deps; `Menu`/`DotsThreeIcon` imports dropped from the file.
- 2026-04-27: Fixed sticky chat-input placeholder. `MentionEditor` now binds Tiptap's `Placeholder.configure({ placeholder })` to a function that reads from a ref kept in sync with the prop, and a small effect dispatches a no-op transaction on prop change so the decoration repaints immediately. Without this, the editor instance keeps its initial placeholder string (Tiptap's `setOptions` doesn't re-instantiate extensions), so swaps like "Send a message..." → "Add to queue..." → back to "Send a message..." (after stream end) and "Open a workspace first..." → "Ask anything..." (on home after picking a workspace) used to stick on whichever value the editor was constructed with.
- 2026-04-27: Added per-conversation prompt queue (client-only, FIFO). New `app/src/features/conversations/prompt-queue.ts` (Zustand store keyed by conversation id) and `app/src/components/chat/QueuedPromptBubble.tsx` (ghost user-bubble with remove (x)). `ConversationPane.handleSend` enqueues mid-stream sends; `runConversationStream`'s `finally` (in `conversation-store.ts`) drains the head of the queue via `sendMessage` on every stream outcome (finished / aborted / errored), so Stop only kills the in-flight turn — queued prompts still fire afterwards. `ChatInput` keeps the Stop-only button while streaming (Enter still enqueues), and the input placeholder swaps to "Add to queue...". `MessageList` appends ghost bubbles after live messages and includes queue length in its stick-to-bottom deps. `archiveConversation` / `deleteConversation` clear the queue. No DB / server changes; no reload persistence.
- pre-2026-04-27: Per-turn cost estimate in the assistant footer (`app/src/features/models/pricing.ts` — `estimateTurnCostUsd` / `formatCostUsd` / `formatTokenCount` against `pricing.standard` rates, long-context multiplier >272K input, reasoning tokens treated as already-in-output; `MessageFooter` renders `~$X.XX` with a Tooltip breaking down input/output × $/MTok). Refreshed `/models` catalog (added `pricing` USD-per-1M-tokens with `standard`/`priority`/`batch`/`longContext` tiers on `ModelCatalogEntry`, both server and app; refreshed gpt-5.5 metadata; fixed gpt-5.4-mini context window 200K→400K and max output 65K→128K; fallback entry in `context.service.ts` includes `pricing: null`); added split chat panes (1–3 conversations side-by-side) — `app/src/features/split-panes/` Zustand store with `persist` (`agnt:split-panes:v1`), extracted `app/src/components/chat/ConversationPane.tsx`, new `app/src/components/layout/SplitPaneArea.tsx` (drag-drop + resize handles), draggable `ConversationRow`, hotkey routing via `PaneScopeProvider`/`usePaneFocus` so chord targets always follow the focused pane; `archive` / `delete` / workspace remove keep the layout coherent via `forgetConversation` / `clearWorkspace`. Added global LLM memory system (`server/src/modules/memories/` CRUD over `~/.agnt/memories/<uuid>.md`; ungated `memory_write` / `memory_read` / `memory_delete` tools; `buildMemoryIndexBlock` injected after rules; `memory_read` allowed in plan mode); added global Rules system (`server/src/modules/rules/` over `~/.agnt/rules/<uuid>.md`, `/rules` HTTP routes, `buildUserRulesBlock` injected after skills, "Rules" Settings panel; system prompt grew to 11 ordered blocks); removed automatic AGENTS.md / CLAUDE.md injection (agent reads repo markdown via `read_file` now); MCP support via `~/.agnt/mcp.json` global + `<workspace>/.agnt/mcp.json` project (tools exposed as `mcp__<server>__<tool>`, agent mode only); `/` slash commands in chat input (`/agent`, `/plan`, `/ask`, `/bypass` toggle modes; `/init` prompt expansion; `/<skill>` auto-loads a skill); per-route chat-input draft persistence (Tiptap JSON in localStorage); auto-compaction inside the SSE stream (also trims `tool_invocations.output_json`, deterministic markdown fallback, runs on `/reply` path too); mid-turn tool-result trim via `prepareStep` (shrinks oversized in-flight outputs without touching DB rows); local-dev Tauri icon split (`app/src-tauri/icons/local/` via `tauri.localdev.json` for `bun run local:dev`); assistant message footer (generation time + model + hover-reveal copy button) with pause-aware clock; initial contract; Codex OAuth/SSE streaming; agent tool framework; context meter + auto-compaction; tool permission system; skills; subagents (`task` tool); ungated `question` / `todo_write` / `write_plan` tools; `write` / `str_replace` / `apply_patch` edit tools; `image_gen`; LSP diagnostics; global stats dashboard; notifications + Windows taskbar badge; soft-archive flow for conversations; real interactive terminals in right sidebar via `portable-pty` (Rust) + xterm.js (frontend), separate from the agent's `shell` tool; reworked system prompt composition into nine ordered blocks (Identity / Communication / Mode / Tool calling / File editing / Long-running commands / Git safety / Environment / Skills).

---

## Pre-PR checklist

- [ ] No generated files manually edited
- [ ] Ports / auth / startup assumptions still coherent
- [ ] AGENTS.md updated if workflow / contract changed
- [ ] Health / readiness still accurate
