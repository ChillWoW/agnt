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
  - `split-panes/` — global split-pane layout (1–3 conversations side-by-side, freely mixing workspaces); each `SecondaryPane` carries its own `workspaceId`. Persisted via Zustand `persist` to `agnt:split-panes:v2`. `pane-scope.tsx` exposes `usePaneScope` / `usePaneWorkspaceId` so deeply-nested chat components resolve the *pane's* workspace, not the globally-active one. The conversation-store keeps a `workspaceIdByConversationId` map so the URL-bound primary pane can find its owning workspace
  - `models/`, `permissions/`, `questions/`, `plans/`, `slash-commands/`, `chat-drafts/`, `mcp/`, `stats/`, `context/`, `notifications/`, `hotkeys/`, `right-sidebar/terminals/`
- `components/chat/` — chat UI (`MessageBubble`, `ToolCallCard`, `PermissionCard`, `QuestionCard`, `ContextMeter`, etc.). `ToolCallCard.tsx` is a thin dispatcher; per-tool block components live in `components/chat/tool-cards/<ToolName>Block.tsx`, with the shared `ToolBlock` primitive + formatters / partial-JSON parser / `TerminalPane` / `PostEditDiagnostics` in `components/chat/tool-cards/shared/`.
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
- `~/.agnt/workspaces.json` — workspace registry. The "Home" workspace is reserved (`HOME_WORKSPACE_ID = 00000000-0000-4000-8000-000000000001`), always present, always pinned to index 0, points at the OS user home (`os.homedir()`, refreshed every load), and cannot be removed (server `removeWorkspace` rejects, sidebar hides "Close workspace").
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

- 2026-04-29: Wired the new `toast` API into the app's existing CRUD flows so users get explicit feedback for cross-cutting actions instead of silent rollbacks. Workspaces (`app/src/features/workspaces/workspace-store.ts`): `add` toasts success ("Opened/Switched to <name>" with the path as description) and error; `remove` toasts success ("Closed <name>") and error. Conversations (`app/src/features/left-sidebar/sidebar.tsx`): archive shows a success toast with an inline `Undo` action that calls `unarchiveConversation`; rename, pin/unpin, restore (unarchive), and the permanent-delete confirm-dialog flow each toast success + error. Stream errors (`conversation-store.ts` SSE `case "error"`) toast `Generation failed` with the server's `{ message }`. Home route `createConversation` failure (`app/src/routes/index.tsx`) toasts `Couldn't start conversation`. Rules (`app/src/features/rules/store.ts`): `createRule` / `updateRule` / `deleteRule` each toast success ("Rule added" / "Rule saved" / "Rule deleted") and error. MCP (`app/src/features/mcp/mcp-store.ts`): `upsertServer` toasts `Added/Updated <name>` with scope-aware description, `deleteServer` / `setServerDisabled` / `refreshServer` toast both success + error (refresh additionally toasts the server's status — `Reconnected` w/ tool count, or `failed to reconnect` w/ the server's `error` field); `McpServersSettings.tsx` raw-JSON save toasts on success. Plans (`app/src/features/plans/PlanPanel.tsx`): `handleBuild` toasts `Building from plan` (with todo count) on success and `Couldn't build from plan` on error. Settings (`app/src/features/settings/store.ts`): `updateCategory` failure now toasts `Couldn't save settings` in addition to the existing rollback. Message-footer copy (`app/src/components/chat/MessageFooter.tsx`) toasts on clipboard failure (was previously silent). Server connection: new `app/src/features/server/ServerConnectionToaster.tsx` (re-exported from `@/features/server`) listens to `useServerConnection` and fires a persistent (`duration: Infinity`, `id: "server-connection-lost"`) error toast on `connected → error` transition and a brief success toast on `error → connected`; mounted once in `app/src/routes/__root.tsx` next to `AuthBootstrap` / `NotificationsBootstrap`. Toasts are NOT added at points that already have inline error UI (attachments bar, file viewer retry, terminal pane "[Failed to spawn shell]", MCP modal `formError` row, rules panel `error` banner) to avoid double-surfacing the same failure. New deps: none — all of this rides on the `react-hot-toast`-backed `toast` API added earlier today.
- 2026-04-29: Added toast notifications via `react-hot-toast` (new dep in `app/package.json`). `app/src/components/ui/Toast.tsx` exports `AppToaster` (themed `<Toaster>` pinned `bottom-right`, 16px edge gutter, 8px between toasts) and a custom `toast` API with structured payloads — calls take an object `{ title, description?, icon?, action?: { label, onClick }, dismissible? }` plus optional `{ id, duration, position }`. Variants: `toast(payload)` (default, no icon), `toast.success` / `toast.error` / `toast.info` / `toast.loading` (variant icon from phosphor — `CheckCircleIcon` / `WarningCircleIcon` / `InfoIcon` / `SpinnerGapIcon` w/ `animate-spin` — colored with `#7ea8d8` success+info, `#e06c6c` error, `dark-100` neutral; pass `icon: null` to suppress, or `icon: <node>` to override). Cards rendered via `toast.custom` with their own dark-850 / dark-700 / dark-50 styling matching Tooltip + Modal, slide-in/slide-out via `data-[visible]` flag, optional inline action button, dismiss (X) in the top-right. Default durations: 3.5s normal, 5s error, `Infinity` loading. Also exposed `toast.dismiss(id?)`, `toast.remove(id?)`, and `toast.promise(promise, { loading, success, error })` with success/error allowed as functions of the resolved value / rejection. Mounted `<AppToaster />` once inside `HotkeysProvider` in `app/src/routes/__root.tsx` (sibling of `<AppLayout>`). Re-exported from the `@/components/ui` barrel: `import { toast } from "@/components/ui"`, then e.g. `toast.success({ title: "Saved", description: "Your changes have been written." })`.
- 2026-04-29: Shrank `shell` / `await_shell` inline-output budget fed back to the model from 200K → 25K chars (`MAX_INLINE_OUTPUT_CHARS` in `server/src/modules/conversations/tools/shell.ts` + `await-shell.ts`) and rewrote `truncateForModel` to keep ~4K head + ~21K tail with a `[... truncated N chars from the middle ...]` marker (the in-memory rolling buffer in `shell.logs.ts` already keeps the last 1 MiB and the full stream is persisted at `log_path`, so the model can `read_file` it on demand). UI is unchanged — `TerminalPane` reads `partial_output` from `tool_invocations.output_json` which is still capped at the 1 MiB in-memory buffer, not at this inline budget.
- 2026-04-29: Split `app/src/components/chat/ToolCallCard.tsx` (was ~3000 lines) into per-tool block files under `app/src/components/chat/tool-cards/`. The dispatcher (`ToolCallCard.tsx`) is now ~95 lines and just routes `invocation.tool_name` to one of `tool-cards/<Name>Block.tsx`. Shared building blocks live in `tool-cards/shared/`: `ToolBlock.tsx` (the universal pending/success/error/denied primitive + auto-open/auto-close behavior, also re-exported from `ToolCallCard.tsx` so existing `import { ToolBlock } from "./ToolCallCard"` consumers — currently `ThinkingBlock` — keep working without churn), `format.ts` (`isRecord`, `clampDetail`, `normalizePath`, `trimWorkspacePath`, `formatReadPath`, `truncate`, `formatByteCount`, `formatCharCount`, `hostnameOf`, `faviconUrl`, `formatShellDuration`), `partial-json.ts` (`extractPartialTopLevelStrings` for streaming write/str_replace/apply_patch input previews), `PostEditDiagnostics.tsx` (post-edit LSP summary used by all three edit tools), and `TerminalPane.tsx` (ANSI-aware shell output renderer used by `ShellBlock` + `AwaitShellBlock`). Tool-specific helpers stay collocated: `parsePatchForPreview` lives in `ApplyPatchBlock.tsx`, `chunksFromPersistedOutput` in `ShellBlock.tsx`, the compaction-trim sentinel + `isCompactTrimmedOutput` guard in `CompactionTrimmedBlock.tsx`. No behavior changes; `ToolCallCard` and `ToolBlock` exports keep their existing import paths so `MessageBubble`, `WorkedSummary`, and `ThinkingBlock` were untouched.
- 2026-04-29: Added conversation pinning with a global "Pinned" sidebar group. Persisted server-side as a single nullable `pinned_at TEXT` column on `conversations` (`server/src/lib/db.ts` schema + idempotent `addColumnIfMissing` migration + `idx_conversations_pinned` index keyed on `(hidden, parent_conversation_id, pinned_at DESC)`); zod schema in `server/src/modules/conversations/conversations.types.ts` and `conversationFromRow` / `CONVERSATION_SELECT` in `conversations.service.ts` propagate the new field. New `pinConversation` / `unpinConversation` service functions + `POST /workspaces/:id/conversations/:conversationId/pin` and `/unpin` routes (`conversations.routes.ts`); `archiveConversation` now also clears `pinned_at` (auto-unpin on archive — Pinned group is meant to surface active work). Frontend mirrors the `pinned_at?: string | null` field on `Conversation` (`app/src/features/conversations/conversation-types.ts`), adds `pinConversation` / `unpinConversation` API helpers + store actions with optimistic timestamp updates and rollback (`conversation-api.ts`, `conversation-store.ts`); `archiveConversation` optimistically clears `pinned_at` to mirror the server. New `PinnedGroup` component in `app/src/features/left-sidebar/sidebar.tsx` renders pinned rows from every workspace in a single collapsible group at the top of the sidebar (above all workspace lists, below "New Agent"); ordering is `pinned_at DESC` so re-pinning bumps the row to the top. `useEagerLoadAllConversations` in the same file (called from `LeftSidebar`) calls `loadConversations` for every registered workspace on mount/changes so pinned rows from collapsed workspaces still appear in the global group. `WorkspaceConversations` filters `pinned_at !== null` rows out of each workspace's normal list (pinned rows live in exactly one place). `ConversationRow`'s leading-icon slot becomes a click-to-toggle button: both pinned and unpinned rows show `MinusIcon` at rest and swap to `PushPinSimpleIcon` on row-hover (`weight="fill"` if already pinned, `regular` otherwise) — clicking toggles pin state. Both icons share the same absolute-positioned slot so the title doesn't shift horizontally on hover. Streaming / pending-permission / pending-question states still take precedence over the pin slot. Added `Pin` / `Unpin` (with `PushPinSimpleSlashIcon`) as the first item in the row's right-click `ContextMenu`. Pinned-group expand/collapse persists via new `isPinnedGroupCollapsed` field on `useLeftSidebarStore` (`agnt:left-sidebar` localStorage namespace).
- 2026-04-29: Added always-present "Home" workspace pinned to the OS user home directory. Reserved id `HOME_WORKSPACE_ID = 00000000-0000-4000-8000-000000000001` (valid v4 UUID so it satisfies the existing `z.string().uuid()` schema) lives in `server/src/modules/workspaces/workspaces.types.ts`. New `ensureHomeWorkspace(registry)` in `server/src/modules/workspaces/workspaces.service.ts` runs inside `loadRegistry` (and persists if anything changed): inserts the entry at index 0 if missing, refreshes its `path` to `os.homedir()` and its name to `"Home"`, force-pins it to index 0 if it drifted, and seeds `activeWorkspaceId` to the home id when the registry has no active workspace. `removeWorkspace` short-circuits with "The Home workspace cannot be closed." before touching the registry. Frontend mirrors `HOME_WORKSPACE_ID` in `app/src/features/workspaces/workspace-types.ts` (re-exported from the feature index) and `WorkspaceSidebarList` (`app/src/features/left-sidebar/sidebar.tsx`) sorts the home workspace to index 0 unconditionally regardless of `workspaceOrder`; `WorkspaceRow` flips off `draggable` and the `onDragStart`/`onDragOver`/`onDrop`/`onDragEnd` handlers for home, and the row context menu hides the "Close workspace" item (separator + destructive item collapse together). New Agent / View archived still work on home like any other workspace; per-workspace SQLite, file tree, and tool resolution all key off the workspace id and path so no per-feature special-casing was needed.
- 2026-04-28: Added "Worked for Hh Mm Ss" collapse pill. New `app/src/components/chat/WorkedSummary.tsx` stacks every reasoning block AND every tool call from a finished assistant turn behind a single click-to-expand row showing the wall-clock span of that work; expanded body re-renders the original `ThinkingBlock`s and `ToolCallCard`s in their stream order so each item keeps its own per-card collapse and tool-specific UI. `MessageBubble` (`app/src/components/chat/MessageBubble.tsx`) gates the collapse on `!message.isStreaming` so live progress is still visible during a turn — the stack only forms once the SSE `finish`/`abort` lands. Pill duration prefers the server-persisted `generation_duration_ms` (already pause-aware for permission/question waits, matches the footer) and falls back to first-entry → now for legacy rows. Detail row counts thoughts/tools and surfaces failed-tool count.
- 2026-04-27: Fixed "Conversation not found" when clicking a sidebar conversation in a non-active workspace. Conversations live in per-workspace SQLite (`~/.agnt/workspaces/<id>/conversations.db`), so `loadConversation(activeWorkspaceId, conversationId)` 404s when the route mounts before the active workspace switches. `WorkspaceConversations.handleOpen` (`app/src/features/left-sidebar/sidebar.tsx`) and `WorkspaceArchivedList`'s click/keyboard handler now call `useWorkspaceStore.setActive(workspaceId)` first when the clicked workspace isn't already active, then navigate. `setActive` (`app/src/features/workspaces/workspace-store.ts`) also flips `activeWorkspaceId` optimistically before the server round-trip so the route mounts with the correct workspace id without waiting on the API.
- 2026-04-27: Alt+<digit> switches the focused split pane (Alt+1 → primary, Alt+2 → first secondary, Alt+3 → second secondary). Implemented as a plain `keydown` listener inside `app/src/components/layout/SplitPaneArea.tsx` — deliberately NOT registered through `useHotkey`/`hotkeys-store` so it isn't user-remappable and doesn't show up in the hotkey settings. Only active while a split is visible (`totalPanes > 1`); in single-pane mode the listener is detached so Alt+digit isn't swallowed. Uses `event.code` (`Digit1`..`Digit9`) instead of `event.key` so it works regardless of keyboard layout / Opt-modified macOS characters; calls `preventDefault` only when it actually maps to a visible pane and updates `setFocusedPaneIndex` (which already drives the focus accent and pane-scoped hotkey routing).
- 2026-04-27: Early-Stop discards the in-flight prompt. `POST /workspaces/:id/conversations/:conversationId/stop` now accepts `{ discardUserMessage: boolean }`; the cancellation registry in `server/src/modules/conversations/conversation.stream.ts` carries the `userMsgId` + `assistantMsgId` for the in-flight turn so the route handler can DELETE both rows (the empty assistant placeholder is pre-empted in the same handler to avoid racing the stream's own `onAbort` cleanup), and falls through to `deleteConversation` when no `user`/`assistant` rows remain (brand-new conversation case). Client `stopGeneration` (`app/src/features/conversations/conversation-store.ts`) takes `{ discardUserMessage }`, mirrors the server-side row + conversation deletion locally, and returns `{ stopped, discardedUserMessage, conversationDeleted }`. `ConversationPane` detects "Planning next moves" (assistant placeholder still empty) on Stop, calls `stopGeneration` with the discard flag, writes the user prompt back as a `chat-drafts` snapshot, and either bumps the new `restoreEpoch` (existing conversation — `ChatInput` listens to the per-slot epoch and re-hydrates the live editor without a remount) or navigates to `/` after seeding the home draft (deleted conversation case).
- pre-2026-04-27: Live context meter during a turn (SSE handler bumps `context-refresh` on `user-message`/`tool-result` with a 150ms trailing-edge debounce + `AbortController`-based stale fetch cancellation, so the meter updates mid-turn instead of only on `finish`/`abort`/`compacted`). Server-driven Stop preserves duration + cost (new `POST /workspaces/:id/conversations/:conversationId/stop` route + `cancelConversationStream` registry, per-conversation `AbortController` map merged with request signal, `onAbort` aggregates usage onto `messages` + stats ledger, `abort` SSE event carries `lastUsage` + model + generation_duration, client `stopGeneration` POSTs `/stop` with 5s local-abort fallback so `MessageFooter` shows "Xs - model - ~$Y.YY" after Stop). Added `general` settings category with `restrictToolsToWorkspace` (default `true`) gating `resolveWorkspacePath`'s workspace-boundary check; new `GeneralSettings` panel registered first in `settingsCategories`. Replaced sidebar workspace-row dot-menu with right-click `ContextMenu` (Base UI) on `WorkspaceRow` (New agent / View archived / Close workspace); only `+` New Agent button remains on hover. Fixed sticky chat-input placeholder (`MentionEditor` reads the placeholder via a ref + dispatches a no-op transaction on prop change so Tiptap's `Placeholder` decoration repaints). Per-conversation prompt queue (`app/src/features/conversations/prompt-queue.ts`, `QueuedPromptBubble`) — client-only FIFO drained from `runConversationStream`'s finally; per-turn cost estimate in the assistant footer (`app/src/features/models/pricing.ts` — `estimateTurnCostUsd` / `formatCostUsd` / `formatTokenCount` against `pricing.standard` rates, long-context multiplier >272K input, reasoning tokens treated as already-in-output; `MessageFooter` renders `~$X.XX` with a Tooltip breaking down input/output × $/MTok). Refreshed `/models` catalog (added `pricing` USD-per-1M-tokens with `standard`/`priority`/`batch`/`longContext` tiers on `ModelCatalogEntry`, both server and app; refreshed gpt-5.5 metadata; fixed gpt-5.4-mini context window 200K→400K and max output 65K→128K; fallback entry in `context.service.ts` includes `pricing: null`); added split chat panes (1–3 conversations side-by-side) — `app/src/features/split-panes/` Zustand store with `persist` (`agnt:split-panes:v1`), extracted `app/src/components/chat/ConversationPane.tsx`, new `app/src/components/layout/SplitPaneArea.tsx` (drag-drop + resize handles), draggable `ConversationRow`, hotkey routing via `PaneScopeProvider`/`usePaneFocus` so chord targets always follow the focused pane; `archive` / `delete` / workspace remove keep the layout coherent via `forgetConversation` / `clearWorkspace`. Added global LLM memory system (`server/src/modules/memories/` CRUD over `~/.agnt/memories/<uuid>.md`; ungated `memory_write` / `memory_read` / `memory_delete` tools; `buildMemoryIndexBlock` injected after rules; `memory_read` allowed in plan mode); added global Rules system (`server/src/modules/rules/` over `~/.agnt/rules/<uuid>.md`, `/rules` HTTP routes, `buildUserRulesBlock` injected after skills, "Rules" Settings panel; system prompt grew to 11 ordered blocks); removed automatic AGENTS.md / CLAUDE.md injection (agent reads repo markdown via `read_file` now); MCP support via `~/.agnt/mcp.json` global + `<workspace>/.agnt/mcp.json` project (tools exposed as `mcp__<server>__<tool>`, agent mode only); `/` slash commands in chat input (`/agent`, `/plan`, `/ask`, `/bypass` toggle modes; `/init` prompt expansion; `/<skill>` auto-loads a skill); per-route chat-input draft persistence (Tiptap JSON in localStorage); auto-compaction inside the SSE stream (also trims `tool_invocations.output_json`, deterministic markdown fallback, runs on `/reply` path too); mid-turn tool-result trim via `prepareStep` (shrinks oversized in-flight outputs without touching DB rows); local-dev Tauri icon split (`app/src-tauri/icons/local/` via `tauri.localdev.json` for `bun run local:dev`); assistant message footer (generation time + model + hover-reveal copy button) with pause-aware clock; initial contract; Codex OAuth/SSE streaming; agent tool framework; context meter + auto-compaction; tool permission system; skills; subagents (`task` tool); ungated `question` / `todo_write` / `write_plan` tools; `write` / `str_replace` / `apply_patch` edit tools; `image_gen`; LSP diagnostics; global stats dashboard; notifications + Windows taskbar badge; soft-archive flow for conversations; real interactive terminals in right sidebar via `portable-pty` (Rust) + xterm.js (frontend), separate from the agent's `shell` tool; reworked system prompt composition into nine ordered blocks (Identity / Communication / Mode / Tool calling / File editing / Long-running commands / Git safety / Environment / Skills).

---

## Pre-PR checklist

- [ ] No generated files manually edited
- [ ] Ports / auth / startup assumptions still coherent
- [ ] AGENTS.md updated if workflow / contract changed
- [ ] Health / readiness still accurate
