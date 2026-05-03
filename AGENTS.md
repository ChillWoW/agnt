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
  - `models/`, `permissions/`, `questions/`, `plans/`, `slash-commands/`, `chat-drafts/`, `mcp/`, `stats/`, `context/`, `notifications/`, `hotkeys/`, `right-sidebar/terminals/`, `right-sidebar/browser/` (incl. `browser-ai-store.ts` for the "agent is using browser" UI)
  - `conversations/browser-ops-bridge.ts` — singleton bridge that receives `browser-op-required` SSE events, picks/creates an agent tab, executes the op via Tauri eval (preload `__agnt_browser__.__run`), and POSTs the result to the server. Booted once in `routes/__root.tsx`.
- `components/chat/` — chat UI (`MessageBubble`, `ToolCallCard`, `PermissionCard`, `QuestionCard`, `ContextMeter`, etc.). `ToolCallCard.tsx` is a thin dispatcher; per-tool block components live in `components/chat/tool-cards/<ToolName>Block.tsx`, with the shared `ToolBlock` primitive + formatters / partial-JSON parser / `TerminalPane` / `PostEditDiagnostics` in `components/chat/tool-cards/shared/`.
- `components/settings/` — settings panels
- `lib/api.ts` — shared HTTP client + auth header

### Tauri host (`app/src-tauri/`)
- `src/lib.rs` — sidecar lifecycle, terminals, browser tabs, badge command
- `src/terminals.rs` — interactive PTYs (`portable-pty`)
- `src/browser.rs` — child-webview-per-tab browser. `BrowserState` keeps a `HashMap<id, Webview>`; commands `browser_open`/`navigate`/`back`/`forward`/`reload`/`stop`/`hard_reload`/`clear_cookies`/`clear_cache`/`get_url`/`set_bounds`/`set_visible`/`close`/`list_alive`/`eval`/`meta_report`/`op_result`/`screenshot` and events `browser://navigated`/`title`/`favicon`/`load-state`/`url-report`/`op-result`. Requires `tauri = { features = ["unstable"] }` for `Window::add_child` + `WebviewBuilder`. `browser_op_result` re-emits agent op results from the preload as `browser://op-result` for the React-side bridge. `browser_screenshot` is currently a stub (Tauri 2.10 has no per-webview capture primitive). `clear_cookies` iterates `webview.cookies()` + `delete_cookie`; `clear_cache` snapshots cookies, calls `clear_all_browsing_data` (which is the only granularity Tauri exposes), then re-sets the cookies — note this still wipes localStorage / IndexedDB. All tabs share a single profile dir at `~/.agnt/browser-profile/`.
- `assets/browser-preload.js` — initialization script injected into every browser-tab webview. Reports title/favicon/url back to the host and exposes `window.__agnt_browser__` with a `__run({opId, op, args})` dispatcher implementing snapshot (compact YAML a11y tree with `[ref=N]`), read (lightweight Readability-style markdown), find, click, type (using native input setters so React controlled inputs see the change), pressKey, scroll, wait_for, get_state, and eval. All ops report back via the `browser_op_result` IPC command.
- `capabilities/default.json` — Tauri permissions
- `gen/schemas/*` — generated, don't edit

### Server (`server/src/`)
- `index.ts` — CLI entry, CORS/auth, Bun serve
- `app.ts` — Elysia app + readiness guard
- `lib/db.ts` — per-workspace SQLite helper (open / cache / migrate)
- `lib/stats-db.ts` — append-only stats ledger at `~/.agnt/stats.db`
- `modules/`:
  - `conversations/` — conversation CRUD (per-workspace SQLite); `conversation.stream.ts` wires `streamText`; `conversation.prompt.ts` composes the system prompt
  - `conversations/tools/` — agent tool defs + registry (`AGNT_TOOL_DEFS`, `UNGATED_TOOL_NAMES`); `tools/browser/index.ts` hosts the 18 `browser_*` tools that drive the right-sidebar webview via `requestBrowserOp`
  - `conversations/permissions/` — `buildConversationTools` + `withPermission` gate
  - `conversations/browser/` — server-side `browser_*` tool gate (request/resolve/cancel/abort) modeled on `questions/gate.ts`; SSE events `browser-op-required` / `browser-op-resolved`
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

- 2026-05-03: Right-sidebar **Git panel** — first real implementation (was a placeholder showing the string "Git Changes"). New server module `server/src/modules/git/` (`git.types.ts`, `git.service.ts`, `git.routes.ts`) shells out to system `git` via `Bun.spawn` and exposes `GET /workspaces/:id/git/status`, `GET /workspaces/:id/git/diff?path&side&oldPath`, `POST .../stage`, `.../unstage`, `.../stage-all`, `.../unstage-all`, `.../discard`, `.../commit`. Status combines `git status -z --porcelain=v1` (NUL-delimited; rename/copy aware) with parallel `git diff --numstat -z` runs (one cached, one worktree) so each row carries `+N -M` line counts and a `binary` flag; untracked files are line-counted by reading the file directly (capped at 1 MB). Branch info comes from `git status -b --porcelain=v2` (handles detached HEAD, unborn branches, and ahead/behind via `branch.ab`). Diff loader uses `cat-file -e` to distinguish "missing on this side" from real errors and `cat-file -s` to skip files >1 MB before `git show`; renames pull the old blob via the porcelain-reported `oldPath`. Commit posts via `commit -F -` so multi-line bodies bypass shell quoting. All git invocations force `LANG=C LC_ALL=C GIT_TERMINAL_PROMPT=0 GIT_PAGER=cat`. Frontend module `app/src/features/right-sidebar/git/` (`git-types.ts`, `git-api.ts`, `git-store.ts`, `git-view.tsx`, `index.ts`) — zustand store with per-row stage/unstage/discard busy keys, diff cache keyed by `${side}::${path}`, focus + 6s-interval polling. New `GitView` reuses `<PierreDiff>` for the inline diff body so we get the same slack-dark/sticky-header treatment that `WriteBlock`/`StrReplaceBlock`/`ApplyPatchBlock` already use. UI matches the rest of the app — Phantom sans-serif throughout (no monospace), `dark-N` palette, file-icon glyph + small kind badge (M/A/D/U/!) per row, hover-only stage/discard overlay (uses `pointer-events-none` on the overlay so empty gaps stay click-through to the row), accent border-left on the selected row, sticky section headers (Staged / Changes / Conflicts) with bg-dark-950/90 backdrop blur, and `react-textarea-autosize` for the commit composer with Cmd/Ctrl+Enter to commit. Empty/no-repo/error states are real placeholders (not "Coming soon"). Wired into `server/src/app.ts`'s `.use(gitRoutes)` chain and into `app/src/features/right-sidebar/tabs/git-tab.tsx` as `<GitView/>`.
- 2026-05-03: `readAuthFile` is now non-destructive. Earlier versions overwrote `~/.agnt/auth.json` with the empty placeholder from THREE failure paths (`readFile` throws, `JSON.parse` throws, schema unrecognized). On Windows that meant a transient share-violation against `writeAuthFile`'s atomic rename window — or, far worse, an older sidecar (e.g. a stale Tauri prod build still running pre-multi-account code) writing `{}` back — would ratchet the file toward empty and silently destroy connected accounts. Now: `readFile` retries up to 3× with 25/50ms backoff for Windows EBUSY, every failure path returns an in-memory empty `StoredAuthFile` and LEAVES THE DISK UNTOUCHED, and the legacy v1 → v2 migration goes through the atomic `writeAuthFile` (with a swallowed-error fallback so a failed persist just retries on the next save). Symptom this fixed: "I have an active account but the app keeps saying Codex not connected" — the on-disk file was being repeatedly nuked to `{}` by an older sidecar reader-that-also-writes.
- 2026-05-03: Multi-account follow-up fixes. (a) `auth.service.writeAuthFile` now writes to a `.tmp-<uuid>` sibling and atomically `rename`s over `auth.json` — closes the race where a concurrent OAuth callback could observe a half-written file, fall through `readAuthFile`'s "empty placeholder" branch, and silently flip `activeAccountId` onto the freshly-added account. (b) The auto-activate rule in `addOrUpdateAccount` is now spelled out as an explicit `if/else` (semantically identical, but immune to subtle precedence issues) — adding a 2nd+ account NEVER touches `activeAccountId` if the previously-active row still exists. (c) New `account.name` field (server `StoredCodexAccount` + frontend `AuthAccount`): pulled from the id_token's standard OIDC `name` claim at OAuth-completion, with `https://chatgpt.com/backend-api/me` as a best-effort fallback when the JWT didn't carry one. UI display chain is now `label > name > email > id` in both `AccountButton` popover and `CodexSettings` cards. (d) Popover is now `max-h-[calc(100vh-120px)]` with an inner scroll region and a pinned "Add another account" footer, and the accounts header shows `Accounts (N)` so the user can immediately tell if all expected rows are loaded — fixes the "I only see one of my accounts" symptom on tall layouts.
- 2026-05-03: Multi-account Codex OAuth. `~/.agnt/auth.json` is now versioned (`version: 2`) with `{ activeAccountId, accounts: [...] }`; legacy single-blob shape auto-migrates on read in `auth.service.readAuthFile`. Per-account `Map<accountId, Promise<string>>` token-refresh mutex replaces the old global one so concurrent turns on different accounts don't serialize. New service helpers: `listAccounts` / `getActiveAccountId` / `getAccount(accountId?)` / `addOrUpdateAccount` / `setActiveAccount` / `setAccountLabel` / `removeAccount` / `disconnectAll` plus an `onActiveAccountChange` listener registry (codex-ws-session subscribes to it and calls `closeAllSessions()` so the next turn re-handshakes under the new credentials). `buildCodexRequestHeaders` / `createCodexClient` / `createCodexWsModel` thread an `accountId` option through; the WS session map key is now `${conversationId}::${accountId}` and `conversation.stream.ts` / `compact.service.ts` / `tools/image-gen.ts` snapshot `getActiveAccountId()` at turn-start so a mid-stream switch can't corrupt baselines. New routes: `POST /auth/accounts/:accountId/activate`, `POST /auth/accounts/:accountId/disconnect`, `PATCH /auth/accounts/:accountId` (label rename), `GET /auth/rate-limits?accountId=`. Legacy `POST /auth/disconnect` is kept as an alias that disconnects ALL accounts. `GET /auth` now returns `{ accounts, activeAccountId }`. Frontend: rewritten `auth-store.ts` exposing `accounts` / `activeAccountId` / `addAccount` / `setActive` / `removeAccount` / `renameAccount` / `disconnectAll` plus selectors (`selectActiveAccount`, `selectIsConnected`); new `avatar-color.ts` deterministic-hue helper (`accountAvatarStyle` + `accountInitial`); rebuilt sidebar `AccountButton` as a multi-account popover (rate-limits header + accounts list with switch / disconnect on hover + "Add another account" footer); rebuilt `CodexSettings` panel as per-account cards with Make active / inline rename / Disconnect + "Connect another account" CTA. `image-gen` tool now also sends `ChatGPT-Account-Id` (was missing before).
- 2026-05-02: Codex WebSocket transient-failure recovery. `codex-ws-session.ts`'s `sendTurn` now blocks on a first-frame gate before returning the SSE-shaped `ReadableStream`: if the WS dies after handshake but before the server emits any `response.*` frame (stale TCP, NAT timeout, server-side load shedding), it throws `CodexWsTurnError` synchronously. `codex-websocket-provider.ts`'s `wsAwareFetch` catches that and transparently retries the same turn over HTTP using the already-decoded body, so the user never sees an error and the next turn re-opens a fresh socket. After-first-frame closes still surface as a stream error (unchanged); the close-handler log now distinguishes `phase=before-frame` vs `phase=after-frame` and includes the in-flight `responseId` to make these failures debuggable without `AGNT_LOG_CODEX_WIRE=1`.
- 2026-04-30: Agent browser tools (the LLM can now drive the right-sidebar webview). 18 new server tools under `server/src/modules/conversations/tools/browser/index.ts` (`browser_list_tabs/open_tab/close_tab/navigate/back/forward/reload/read/snapshot/find/click/type/press_key/scroll/wait_for/get_state/screenshot/eval`). All gated through `requestBrowserOp` in new `server/src/modules/conversations/browser/gate.ts` (mirrors `questions/gate.ts`): server tool emits SSE `browser-op-required`, blocks on a Promise, frontend executes via Tauri eval, POSTs result to new route `POST /workspaces/:id/conversations/:cid/browser-ops/:opId/result`. Preload `app/src-tauri/assets/browser-preload.js` ships a real `__agnt_browser__.__run({opId, op, args})` dispatcher that does snapshot/read (lightweight Readability)/find/click/type/scroll/wait_for/get_state/eval and reports via new `browser_op_result` Tauri command (re-emitted as `browser://op-result`). New `browser_screenshot` Tauri command stubbed (no per-webview capture in Tauri 2.10). Frontend bridge at `app/src/features/conversations/browser-ops-bridge.ts` (singleton, booted in `__root.tsx`) routes events to the conversation's auto-managed "agent tab", auto-reveals the right sidebar, and handles tab-management ops (list/open/close/navigate/back/forward/reload/screenshot) host-side without the preload. Read-only browser tools (`browser_list_tabs/read/snapshot/find/get_state`) default to `allow` in `ALLOW_BY_DEFAULT_TOOL_NAMES`; mutating ones default to `ask`. Tool descriptions push the model toward small payloads (read 8K char default, snapshot 6K, both hard-capped). Plan mode allowlist includes only the read-only browser tools. New `browser-ai-store` (`app/src/features/right-sidebar/browser/browser-ai-store.ts`) drives the visual: animated violet ring around the active webview, status pill ("Agent is using browser - {label}"), gradient sweep above the chrome bar (replaces the regular load bar while AI is active), pulsing glow on the controlled tab pill in the right-sidebar strip. New `BrowserBlock.tsx` chat tool-card handles every `browser_*` tool name. Conversation cleanup (`DELETE /:cid`) also calls `clearConversationBrowserOpState`; `abortBrowserOps` runs alongside `abortQuestions` in stream abort/error paths.
- 2026-04-30: Fixed white-screen on opening a 2nd+ browser tab. `<BrowserTabView>` was rendered without a `key` in `right-sidebar.tsx`, so switching tabs reused the same React instance and the local `opened` flag leaked from the previous tab — short-circuiting the lazy `ensureBrowserOpened` path so the new tab's native webview was never created. Now keyed by `active.id`; also re-sync `opened` from `isBrowserOpened(id)` inside the component as a belt-and-suspenders against future regressions.
- 2026-04-30: Right-sidebar browser tabs — global multi-tab native-webview browser embedded in the right panel. New Rust module `app/src-tauri/src/browser.rs` (BrowserState + open/navigate/back/forward/reload/stop/set_bounds/set_visible/close/list_alive/eval/meta_report commands; emits `browser://navigated`/`title`/`favicon`/`load-state`/`url-report`); requires `tauri` feature `unstable` for `Window::add_child`+`WebviewBuilder`. Preload script `app/src-tauri/assets/browser-preload.js` reports title/favicon/url and reserves `window.__agnt_browser__` (snapshot/findByRef/click/type/screenshot stubs) — the seam future agent browser-tools will fill in. Shared cookie profile at `~/.agnt/browser-profile/`. Frontend `app/src/features/right-sidebar/browser/` (zustand persist, bridge fan-out, ResizeObserver+rAF bounds sync, NewTabPage + chrome bar). `useOpenedFilesStore.active` extended with `{kind:"browser", id}`; browser tabs render as pills in the top strip alongside file pills (per user request); GlobeIcon click and `Ctrl+Alt+B` open a new tab (Chrome-style); webview is hidden via `setBrowserVisible` when sidebar collapses or settings open.
- 2026-04-29: Eager file `@`-mention loads — file-typed `@path` mentions now invoke `read_file` server-side at stream-start (mirrors the slash-skill flow): contents inlined as a trailing per-turn `<active_reads>` system block AND a synthetic `read_file` tool invocation persisted on the assistant message + emitted via SSE so the chat shows a real ReadFileBlock card. Directory mentions still go through `buildMentionsInstructionBlock` (now dir-only). Wired through `streamConversationReply` / `streamEditAndRegenerate` (passes incoming `mentions`), `streamReplyToLastMessage` / `streamRegenerateLastTurn` (re-parses from latest user message text).
- 2026-04-29: Message branching for the latest turn — new schema cols `messages.branch_group_id`/`branch_index` + `conversations.active_branch_group_id`/`active_branch_index` (idempotent migrations); history queries filter via `branchFilteredMessagesClause`; routes `POST .../regenerate` `/edit-and-regenerate` `/switch-branch`; SSE `branch-info` event; UI `BranchNavigator` + `MessageEditor` + edit-pencil/regenerate icons on latest user/assistant; sealing on next user prompt DELETEs non-active siblings.
- pre-2026-04-30: Default-model drift fix (`getDefaultModelId()` in `models.service.ts` mirrors UI's first `status: "recommended"` entry; replaced the hardcoded `DEFAULT_MODEL = "gpt-5.4-mini"` fallback). Wired `toast` API into existing CRUD flows (workspace add/remove; conversation archive+Undo / rename / pin / restore / delete; stream errors; home-route createConversation; rules CRUD; MCP CRUD+refresh; plan build; settings update; message-copy fallback; server-connection toaster). Added `react-hot-toast` + custom `toast` API (`app/src/components/ui/Toast.tsx`) — variants `success`/`error`/`info`/`loading`, structured `{title, description?, icon?, action?, dismissible?}` payloads, `toast.promise`; mounted once via `<AppToaster>` in `__root.tsx`. Shrank inline `shell`/`await_shell` model output budget 200K→25K chars (`MAX_INLINE_OUTPUT_CHARS`, ~4K head + ~21K tail); split `ToolCallCard.tsx` (~3000→~95 lines) into per-tool `components/chat/tool-cards/<Name>Block.tsx` with shared primitives in `tool-cards/shared/`; conversation pinning (`pinned_at` col + `/pin` `/unpin` routes + sidebar global Pinned group across workspaces); always-present "Home" workspace pinned to `os.homedir()` (reserved id `00000000-0000-4000-8000-000000000001`, locked to index 0, not removable); "Worked for Hh Mm Ss" collapse pill (`WorkedSummary.tsx`); cross-workspace sidebar conv-open fix (active-workspace flip before navigate); Alt+digit pane focus switch; Early-Stop discards in-flight prompt; live context meter during turn; server-driven Stop preserves duration+cost; `general` settings category + `restrictToolsToWorkspace`; sidebar workspace-row right-click ContextMenu; sticky chat-input placeholder fix; per-conversation prompt queue; per-turn cost estimate in footer; refreshed `/models` catalog with pricing tiers; split chat panes (1–3 side-by-side) with persisted store + drag-drop + pane-scoped hotkeys; global LLM memory system (ungated `memory_write`/`memory_read`/`memory_delete`, `~/.agnt/memories/`); global Rules system (`~/.agnt/rules/`, `/rules` routes, settings panel); removed auto AGENTS.md/CLAUDE.md injection; MCP via global+project `mcp.json` (`mcp__<server>__<tool>`, agent mode only); `/` slash commands; per-route chat-input draft persistence; auto-compaction inside SSE stream; mid-turn tool-result trim via `prepareStep`; local-dev Tauri icon split; assistant message footer w/ pause-aware clock; initial contract; Codex OAuth/SSE streaming; agent tool framework; context meter + auto-compaction; tool permission system; skills; subagents (`task` tool); ungated `question`/`todo_write`/`write_plan` tools; `write`/`str_replace`/`apply_patch` edit tools; `image_gen`; LSP diagnostics; global stats dashboard; notifications + Windows taskbar badge; soft-archive flow; real PTYs in right sidebar via `portable-pty`+xterm.js (separate from the agent `shell` tool); 9-block system prompt composition.

---

## Pre-PR checklist

- [ ] No generated files manually edited
- [ ] Ports / auth / startup assumptions still coherent
- [ ] AGENTS.md updated if workflow / contract changed
- [ ] Health / readiness still accurate
