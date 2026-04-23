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

### Global settings
- Global app settings are stored at `~/.agnt/settings.json`.
- Supported settings categories are `hotkeys` and `toolPermissions`.
- Legacy/unknown keys are stripped and rewritten on load so removed categories do not persist.

### Agentic modes
- Conversations support two agentic modes: `agent` (default, full editing) and `plan` (read-only + plan creation). Stored as conversation-level state key `agenticMode` via the existing history/state system.
- **Agent mode**: all tools available except `write_plan`. This is the default implementation mode.
- **Plan mode**: restricted tool set — `read_file`, `glob`, `grep`, `use_skill`, `question`, `todo_write`, `shell`, `await_shell`, `web_search`, `web_fetch`, `write_plan`. No file-mutation tools (`write`, `str_replace`, `apply_patch`, `image_gen`). System prompt includes plan-mode instructions telling the model to research and create a plan.
- Mode is resolved in `resolveConversationModelSettings()` in `conversation.stream.ts` and passed to `buildConversationTools()` via `getAgenticMode` on the permission context. Tool filtering happens in `with-permission.ts` — `PLAN_MODE_TOOLS` set controls which tools are available in plan mode.
- Frontend: `AgenticModeSelector` in the chat input bar (next to `PermissionModeSelector`). `useAgenticMode` hook reads/writes the `agenticMode` state key. Hotkey: `Ctrl+Shift+M`.
- Plan files are stored at `~/.agnt/plans/plan-<uuid>.md`. The `plans` SQLite table links each plan to a conversation (one plan per conversation, cascade delete). Plan service at `server/src/modules/conversations/plans/plans.service.ts`.
- `write_plan` tool (ungated) creates/updates the plan. Emits `plan-updated` SSE event. Frontend auto-opens the Plan tab in the right sidebar on this event.
- Plan panel in the right sidebar (`app/src/features/plans/PlanPanel.tsx`) renders plan markdown + todos list + "Build" button.
- Build button: calls `POST /workspaces/:id/conversations/:conversationId/plan/build` which injects plan todos as conversation todos (all `pending`), sets `agenticMode` to `agent`, then the frontend sends a "Build according to the plan" message to start implementation.
- Plan endpoints: `GET/DELETE /workspaces/:id/conversations/:conversationId/plan`, `POST .../plan/build`.

### Conversation storage (SQLite)
- Each workspace has a SQLite database at `~/.agnt/workspaces/<workspaceId>/conversations.db`.
- Tables: `conversations` (id, title, created_at, updated_at), `messages` (id, conversation_id, role, content, persisted reasoning fields `reasoning_content`/`reasoning_started_at`/`reasoning_ended_at`, token columns `input_tokens`/`output_tokens`/`reasoning_tokens`/`total_tokens`, `compacted` flag, `summary_of_until` for compacted summary rows), `attachments` (adds `estimated_tokens`), `state_entries` (latest workspace/conversation key-value state), `history_entries` (append-only workspace/conversation state history), `tool_invocations` (id, message_id, tool_name, input_json, output_json, error, status, created_at) linked to assistant messages with cascade delete, `todos` (id, conversation_id, content, status `pending`/`in_progress`/`completed`/`cancelled`, sort_index, created_at, updated_at) cascade-on-conversation-delete, and `plans` (id, conversation_id UNIQUE, file_path, title, todos_json, created_at, updated_at) cascade-on-conversation-delete.
- `server/src/lib/db.ts` manages per-workspace DB instances with caching and auto-migration.
- Conversations are created lazily on first user message.
- Active conversation streams can be cancelled from the frontend stop button; the frontend aborts the HTTP request, the server forwards `request.signal` into AI SDK `streamText`, and partial assistant text is persisted while empty aborted placeholders are removed.
- Assistant reasoning text and reasoning start/end timestamps are persisted on the message row and returned by conversation fetches so completed/aborted thinking survives app restart and reload.
- Workspace-level and conversation-level metadata/history are exposed under `/workspaces/:id/state|history` and `/workspaces/:id/conversations/:conversationId/state|history`, with `state/effective` providing workspace defaults merged with conversation overrides.
- `GET /models` returns the frontend model catalog used by the chat input selector.
- Conversation streaming resolves model settings from effective state keys: `activeModel`/`model`, `reasoningEffort`/`effort`, and `fastMode`; fast mode maps to OpenAI priority processing when the selected model supports it.
- Conversation system prompts are now composed in `server/src/modules/conversations/conversation.prompt.ts` and include the base assistant instructions, workspace path metadata, and any injected repo instructions resolved from workspace files.
- Repo instruction discovery lives in `server/src/modules/conversations/repo-instructions.ts`. It reads `AGENTS.md`, `CLAUDE.md`, `.agents/AGENTS.md`, and `.claude/CLAUDE.md` from the active workspace root, applies truncation/budget limits, caches by workspace path + file mtimes, and exposes inspection data at `GET /workspaces/:id/repo-instructions`.

### Skills
- Skills are reusable playbooks stored on disk as a directory containing a `SKILL.md` with frontmatter `name:` and `description:`, plus any bundled resource files.
- Discovery roots (later entries override earlier ones on name collision; project always wins over user):
  - User:
    1. `~/.agnt/skills/<name>/SKILL.md`
    2. `~/.agents/skills/<name>/SKILL.md`
    3. `~/.claude/skills/<name>/SKILL.md`
  - Project (inside the active workspace):
    1. `<workspace>/.agnt/skills/<name>/SKILL.md`
    2. `<workspace>/.agents/skills/<name>/SKILL.md`
    3. `<workspace>/.claude/skills/<name>/SKILL.md`
- `server/src/modules/skills/skills.service.ts` walks these roots each stream. Found skills are (a) listed by name/description in the system prompt under `<available_skills>` via `buildAvailableSkillsBlock`, and (b) exposed to the `use_skill` tool through `buildConversationTools({ getSkills })`.
- `GET /workspaces/:id/skills` returns `{ workspacePath, userSkillsDirs, projectSkillsDirs, skills: [{ name, description, directory, source }], warnings }` for inspection.
- `use_skill(name)` tool loads a single skill's full `SKILL.md` body plus a listing of bundled files. Success returns `{ ok: true, name, description, source, directory, content, files }`. Not-found returns `{ ok: false, error, requested, available }` (no throw, so the agent can recover).
- The agent is instructed to call `use_skill` the moment a task matches a listed skill, and never to fabricate skill contents.

### Agent tools
- Tool *definitions* live in `server/src/modules/conversations/tools/` as plain `{ name, description, inputSchema, execute }` objects (`ToolDefinition`). Registry: `server/src/modules/conversations/tools/index.ts` exports `AGNT_TOOL_DEFS` plus an `UNGATED_TOOL_NAMES` set of tools that bypass the permission gate entirely.
- `conversation.stream.ts` builds a per-conversation tool set via `buildConversationTools({ conversationId, mode })` (`server/src/modules/conversations/permissions/with-permission.ts`) which wraps each definition's `execute` through `withPermission`, EXCEPT for tools listed in `UNGATED_TOOL_NAMES` (currently `question`), whose `execute` is passed through unwrapped. The tools are passed to `streamText` with `stopWhen: stepCountIs(Infinity)`.
- Permission gate: each tool call is decided by (1) conversation permission mode (`ask`/`bypass`, effective-state key `permissionMode`), (2) the per-tool setting from the `toolPermissions` settings category (`ask`/`allow`/`deny`), and (3) the in-memory session-allow cache (`allow_session` decisions). Allow-by-default built-ins are explicitly listed in code (`read_file`, `glob`, `grep`, `use_skill`); unlisted future tools default to `ask`. `deny` short-circuits with an error. `ask` routes through `requestPermission` which returns a promise resolved by the frontend. Ungated tools skip this whole flow.
- Tool invocations are persisted in `tool_invocations`: a row is inserted on `tool-call` (status `pending`) and updated on `tool-result` (`success`) / `tool-error` (`error`). Pending rows are marked `error` when the stream aborts or errors.
- SSE protocol events: `tool-call`, `tool-result`, plus permission events `permission-required` (`{ id, messageId, toolName, input, createdAt }`) and `permission-resolved` (`{ id, messageId, decision }`), plus question events `questions-required` (`{ id, messageId, questions, createdAt }`) and `questions-resolved` (`{ id, messageId, answers }`), plus `plan-updated` (`{ conversation_id, plan: { id, title, content, todos, filePath, createdAt, updatedAt } }`). Each carries `messageId` so the frontend attaches them to the right assistant message. `Message.tool_invocations` is part of the conversation fetch payload.
- Permission HTTP endpoint: `POST /workspaces/:id/conversations/:conversationId/permissions/:requestId/respond` with `{ decision: "allow_once" | "allow_session" | "deny" }`. Deleting a conversation also calls `clearConversationPermissionState` to reject pending requests and clear the session-allow cache.
- Question HTTP endpoint: `POST /workspaces/:id/conversations/:conversationId/questions/:requestId/respond` with `{ answers: string[][] }` (one inner array per question, each containing 1+ selected labels or custom-typed strings). Server validates shape, cardinality, and single-select constraints. Deleting a conversation also calls `clearConversationQuestionState` to reject pending requests.
- Tool listing endpoint: `GET /tools` returns `[{ name, description }]` used by the settings panel. Ungated tools (e.g. `question`) are filtered out of this listing so they never show in `Tool permissions`.
- Current tool set:
  - `read_file(path, maxBytes?)` — reads a utf-8 file. Accepts absolute paths, workspace-root-relative paths (leading `/` or `\`), or paths relative to the workspace. Rejects binary (NUL-byte scan), default 256KB cap, hard cap 1MB. Located at `server/src/modules/conversations/tools/read-file.ts`.
  - `glob(pattern, path?, limit?)` — finds files by glob pattern inside the workspace. Path rules follow `read_file`, but absolute paths are only accepted if they live inside the workspace (containment enforced via `resolveWorkspacePath`). Default ignore list prunes `node_modules`, `.git`, `dist`, `build`, `.next`, `target`, `out`, `.venv`, `venv`, `__pycache__`, `coverage`, editor caches, etc. Default limit 100, hard cap 500, hard cap 50k dir entries scanned. Located at `server/src/modules/conversations/tools/glob.ts`.
  - `grep(pattern, path?, include?, caseInsensitive?, maxResults?)` — regex search over workspace files. Shares path/containment rules and ignore list with `glob`. Skips symlinks, binary files (NUL-byte scan), empty files, and files >1MB; global scan cap 50MB total and 50k dir entries. Default 100 matches, hard cap 1000; lines truncated at 400 chars. Located at `server/src/modules/conversations/tools/grep.ts`.
  - `use_skill(name)` — loads a skill playbook by name from the discovery roots listed under **Skills** above. Skill list for the current stream is injected via `createUseSkillToolDef(() => skills)` in `buildConversationTools`. Located at `server/src/modules/conversations/tools/use-skill.ts`.
  - `image_gen({ prompt })` — generates one PNG via the ChatGPT Codex built-in `image_generation` tool on `https://chatgpt.com/backend-api/codex/responses`. Requires an active Codex OAuth connection (same auth as the conversation stream); API-key-only setups are not supported. Model is resolved from the conversation's active model when it has `supportsImageInput: true`, otherwise falls back to `gpt-5.4`; a single-retry fallback to `gpt-5.4` also kicks in on backend error. The returned base64 PNG is persisted through `createAttachment` + `linkAttachmentsToMessage` tied to the current assistant turn, and the tool output `{ ok, attachmentId, fileName, mimeType, prompt, revisedPrompt, model }` is rendered inline inside `ImageGenBlock` in `ToolCallCard` via the existing `/workspaces/:id/attachments/:id/content` endpoint. Defaults to `ask` permission (unlisted tools default to `ask`) so the user approves before credits are spent. Located at `server/src/modules/conversations/tools/image-gen.ts`; requires `getAssistantMessageId` on the permission context (plumbed from `conversation.stream.ts`).
  - `write_plan({ title, content, todos: [{ id?, content }] })` — ungated plan-mode tool. Creates or updates the conversation's implementation plan. Writes markdown to `~/.agnt/plans/plan-<uuid>.md`, upserts into the `plans` table, and emits `plan-updated` SSE. `toModelOutput` returns a compact text confirmation. Only available in plan mode (filtered out in agent mode). Located at `server/src/modules/conversations/tools/write-plan.ts`.
  - `todo_write({ todos: [{ id?, content, status }] })` — ungated planning tool. Atomically REPLACES the conversation's todo list (omitted ids are deleted, new ids minted server-side, existing ids preserve `created_at`). At most one item may be `in_progress` per call (server rejects otherwise). Returns `{ ok: true, todos, counts }`. Located at `server/src/modules/conversations/tools/todo-write.ts`. Persists into the `todos` SQLite table via `server/src/modules/conversations/todos/todos.service.ts`, which also publishes a per-conversation pub/sub the stream subscribes to in order to emit `todos-updated` SSE. The current todos are re-injected into the system prompt every turn via `buildTodosPromptBlock` (consumed in `conversation.prompt.ts`), so the model always sees its own plan without a separate read tool. Counted toward `/context` breakdown under `todos`.
  - `write({ path, contents })` — create a new file or overwrite an existing one with the full UTF-8 `contents`. Path rules match `glob`/`grep` (workspace-containment enforced via `resolveWorkspacePath`; absolute paths must live inside the workspace). Missing parent directories are created automatically and reported back in `createdDirectories`. When overwriting a file that already uses CRLF line endings, incoming LF-only content is transparently normalized to CRLF so edits don't silently flip line-ending style. Hard-capped at 10 MiB per call; refuses to write when the target path exists but isn't a regular file. Description instructs the agent to PREFER `str_replace` over `write` for edits to existing files. Defaults to `ask` permission. Located at `server/src/modules/conversations/tools/write.ts`.
  - `str_replace({ path, old_string, new_string, replace_all? })` — exact string replacement inside an existing text file. Path rules match `write`; file must already exist (use `write` to create). `old_string` must match verbatim including whitespace/indentation; when `replace_all` is false (default) the tool fails unless `old_string` occurs exactly once. `replace_all: true` replaces every occurrence (use for file-wide renames). Identical `old_string`/`new_string` is rejected as a no-op. CRLF compatibility: if the file is CRLF but the incoming `old_string` uses LF only, both `old_string` and `new_string` are normalized to CRLF before the search/replace so the model can quote text it received through `read_file` (which normalizes to LF). Binary files are rejected via NUL-byte scan; file size capped at 10 MiB. Defaults to `ask` permission. Located at `server/src/modules/conversations/tools/str-replace.ts`.
  - `apply_patch({ input })` — apply an OpenAI V4A diff envelope (`*** Begin Patch` … `*** End Patch`) that can `*** Add File`, `*** Update File` (optionally followed by `*** Move to: <newPath>`), and/or `*** Delete File`, with `@@ <anchor>` lines and ` `/`-`/`+` hunk-line prefixes. This is the preferred edit tool on Codex/OpenAI models (that format is in their post-training distribution); `write` and `str_replace` remain available for single-file edits. One call can mutate many files at once. Parser accepts a leading ```/```diff fence or an `apply_patch <<EOF` heredoc wrapper. Server parses the whole envelope, resolves every path through `resolveWorkspacePath` (workspace-containment enforced), pre-flight-checks existence constraints (`Add File` fails if target exists; `Update File` / `Delete File` fails if missing), then applies in memory before writing anything — so a malformed hunk aborts the tool without leaving a half-patched tree. Hunk matching uses `@@ <anchor>` lines to narrow the search window (anchors do substring-match on a line; stack multiple for nested scopes) and requires the combined ` `/`-` before-text to occur exactly once within that window; descriptive errors distinguish "anchor not found", "context not found", "context matches N places". Line endings are matched flexibly (LF/CRLF) and the original EOL style is restored per file. `Move to:` writes the updated content to the new path and `rename`s away from the original (rejects if the destination already exists). Missing parent directories for `Add File` / `Move to:` are auto-created and reported in `createdDirectories`. Hard caps: 10 MiB per file, 32 MiB for the whole patch text. Returns `{ ok: true, changes: [{ op: "add"|"update"|"delete"|"rename", path, relativePath, newPath?, newRelativePath?, oldContents, newContents, linesAdded, linesRemoved, createdDirectories }], summary: { filesChanged, filesAdded, filesDeleted, filesUpdated, filesRenamed, linesAdded, linesRemoved } }` — full old/new contents are included for the frontend diff view. `toModelOutput` narrows what the model receives to a compact textual summary (`Applied N files (+a -b):` + one line per change) so per-file contents don't re-enter the context. Defaults to `ask` permission. Located at `server/src/modules/conversations/tools/apply-patch.ts`.
  - `question({ questions: [{ question, header (≤30 chars), options: [{ label, description }], multiple }] })` — ungated UI tool. Presents one or more multiple-choice questions in the chat input (replacing it, same UX pattern as the permission card) and blocks until the user answers. A "Type your own answer" pill is always rendered client-side, so the model must NOT include catch-all options like "Other"; if an option is recommended, put it first and append ` (Recommended)` to its label. Returns `{ answers: string[][] }` — each inner array is the selected option labels (or the user-typed custom string) for the matching question; even single-select answers come back as a 1-element array. Located at `server/src/modules/conversations/tools/question.ts`; blocks on `requestQuestions` from `server/src/modules/conversations/questions/gate.ts`. This tool bypasses the permission gate entirely and is hidden from the `Tool permissions` settings panel.
  - Workspace-containment + ignored-dir logic lives in `server/src/modules/conversations/tools/workspace-path.ts` and is shared across filesystem-walking tools.
- Frontend renders tool calls as `ToolCallCard` (`app/src/components/chat/ToolCallCard.tsx`) inside the assistant bubble. Pending permission requests are surfaced by the `PermissionCard` above the chat textarea and the sidebar swaps `MinusIcon` for a pulsing `ShieldWarningIcon` on the affected conversation. Pending question requests are surfaced by `QuestionCard` (`app/src/components/chat/QuestionCard.tsx`) which takes priority over `PermissionCard` when both are active and renders all questions in one stacked scrollable card with selectable option pills, a dashed "Type your own" pill that reveals an input, and a single Submit button gated on every question having at least one answer. Mode is toggled via `PermissionModeSelector` next to the model selector. Per-tool defaults live in the new `Tool permissions` settings category.

### Context metering + auto-compaction
- Server-authoritative token usage: AI SDK `streamText` `onFinish` persists `input_tokens`/`output_tokens`/`reasoning_tokens`/`total_tokens` to `messages` and emits a `finish` SSE event with `usage` for the just-completed assistant turn.
- `GET /workspaces/:id/conversations/:conversationId/context` returns `{ modelId, contextWindow, maxOutputTokens, usedTokens, percent, breakdown: { messages, reasoning, toolOutputs, attachments, repoInstructions, systemInstructions, todos }, messageCount, compactedMessageCount, hasCompactSummary, lastCompactedAt, autoCompactThreshold }`. Attachment tokens use stored `estimated_tokens` (fallback re-estimation for legacy rows): text tokenized via `gpt-tokenizer` o200k_base, images = 1105 per image, PDFs ≈ bytes/3. `repoInstructions` tracks injected `AGENTS.md` / `CLAUDE.md` prompt content separately from the base system prompt.
- Auto-compaction: before handling a new user turn in `conversation.stream.ts`, if projected usage crosses `COMPACT_THRESHOLD` (0.85), `compactConversation` summarizes all messages older than the last 6 (3 user/assistant pairs) plus always keeps the most recent user message; older rows are marked `compacted=1`, a single system message with `summary_of_until=<last summarized id>` holding the summary is inserted, and a `compacted` SSE event is emitted with `{ summaryMessageId, summarizedMessageIds, summarizedCount, usedTokensAfter, summaryContent, summaryCreatedAt, summaryOfUntil }`.
- Prompt caching: the Responses API `instructions` field is kept byte-identical across turns for the same conversation (base instructions + workspace block + repo instructions + warnings + skills block). `conversation.stream.ts` sends `promptCacheKey = conversationId` so every turn routes to the same cache node (mirrors `codex-rs/core/src/client.rs`). `promptCacheRetention` is intentionally NOT sent — the ChatGPT backend (`chatgpt.com/backend-api/codex/responses`) rejects it with 400 "Unsupported parameter: prompt_cache_retention"; that knob only exists on the direct OpenAI Platform API, and the Codex CLI doesn't set it either on the ChatGPT-auth path. The `<Current Todos>` block is NOT part of `instructions`; it is injected as a trailing `role: "system"` message on each turn so todo edits never invalidate the cached prefix. `reasoningSummary: "detailed"` is only sent when `reasoningEffort` is active.
- `POST /workspaces/:id/conversations/:conversationId/compact` triggers the same pipeline manually (from the meter popover at ≥85%).
- History queries for model prompting filter `compacted=0`; the system summary row is included verbatim. The conversation fetch payload exposes the new columns so the UI can render a compact banner + collapsible summary in `MessageList`.
- Frontend: `app/src/features/context/` provides `useContextMeter` (merges server summary with client-side tokenization of the draft via `gpt-tokenizer` and pending attachment token estimates). `ContextMeter.tsx` renders an 18px SVG ring with `strokeLinecap="butt"`, color tiers, tooltip breakdown, and a popover at ≥85% that calls `/compact`. Mounted immediately left of the send/stop button in `ChatInput`.
- Deps: `gpt-tokenizer` added to both `server/` and `app/`.

### Global stats dashboard
- `GET /stats?tzOffsetMinutes=<int>` aggregates activity across every workspace's SQLite DB and returns `{ totals: { sessions, userMessages, inputTokens, outputTokens, reasoningTokens, totalTokens, activeDays }, streak: { current, longest }, favoriteModel: { id, label, count } | null, models: { id, label, count }[] (sorted desc), hours: number[24], mostActiveHour: number | null, heatmap: { startDate, endDate, days: { date, count }[210] }, workspaceCount }`.
- `tzOffsetMinutes` is minutes east of UTC (`-new Date().getTimezoneOffset()`), range `−840..840`, default `0`. Applied as a SQLite datetime modifier (`date(created_at, '${sign}${abs} minutes')`) so day/hour buckets line up with the user's local timezone.
- Service at `server/src/modules/stats/stats.service.ts` iterates `listWorkspaces()` and opens each DB via `getWorkspaceDb`. Streaks are computed in JS from the merged `Set<YYYY-MM-DD>` of user-message local days, relative to the user's local "today". Sessions count = `COUNT(*) FROM conversations`. Heatmap window is a rolling 210 days (30 columns × 7 rows).
- Messages carry a `model_id` column on `messages` (TEXT, nullable; migration added). It's populated inside `runStreamTextIntoController` in `conversation.stream.ts` via a patch-in-place `UPDATE messages SET model_id = ? WHERE id = ?` right after `resolveConversationModelSettings` resolves `modelName`, so both the `streamReplyToLastMessage` and `streamConversationReply` paths record the model actually used for each assistant turn. Pre-migration assistant rows stay `NULL` and are excluded from the favorite-model/models-breakdown counts.
- Frontend: `app/src/features/stats/` (types + API client + `useGlobalStats` hook) and `app/src/components/stats/` (`StatsPanel`, `StatCard`, `UsageHeatmap`). The panel is a single compact card rendered on the `/` route above the chat input with one segmented-tab row: `Overview`/`Models` (content toggle). Overview shows a 4×2 tile grid: Sessions · Messages · Total tokens · Active days / Current streak · Longest streak · Peak hour · Favorite model. Models view replaces the tiles with a ranked bar-chart list by model usage. The heatmap always renders the full 210-day window below the tiles with a blue 5-tier scale on `dark-800` cells. A playful footer compares total-token usage to familiar reference texts (Gatsby, Harry Potter, Bible, etc.). Counts user messages only.

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
- `app/src/features/permissions/` — permission mode hook, pending-request Zustand store, tools catalog API, types
- `app/src/features/questions/` — pending-question Zustand store, API client, types for the `question` tool
- `server/src/modules/conversations/permissions/` — in-memory permission gate (request/resolve/abort/session-allow) and `buildConversationTools`/`withPermission` tool adapter
- `server/src/modules/conversations/questions/` — in-memory questions gate (request/resolve/abort) used by the ungated `question` tool to block until the user answers
- `server/src/modules/conversations/tools/question.ts` + `app/src/components/chat/QuestionCard.tsx` — `question` tool definition + chat-input-replacing UI card
- `server/src/modules/conversations/context.service.ts` + `compact.service.ts` + `context.attachments.ts` — token accounting, `/context` endpoint, auto-compaction at 85% threshold, manual `/compact` endpoint
- `app/src/features/context/` — context meter hook, API client, client tokenizer wrapper, shared context/compaction types
- `app/src/components/chat/ContextMeter.tsx` — circular SVG ring in the chat input with compaction popover
- `server/src/modules/conversations/repo-instructions.ts` + `conversation.prompt.ts` — workspace repo-instruction discovery/caching and composed system prompt generation
- `server/src/modules/skills/skills.service.ts` — skill discovery from `~/.agnt/skills` + `<workspace>/.agnt/skills|.agents/skills|.claude/skills`, `<available_skills>` system-prompt block, and shared `findSkill`/`listSkillFiles` helpers used by `use_skill`
- `server/src/modules/conversations/tools/use-skill.ts` — `use_skill` tool definition that loads a skill's full `SKILL.md` body + bundled file listing
- `app/src/components/settings/RepoInstructionsSettings.tsx` — settings view for inspecting active AGENTS.md / CLAUDE.md sources and merged content
- `app/src/components/ui/Tooltip.tsx` — base Tooltip + KeybindTooltip components
- `app/src/components/chat/PierreDiff.tsx` — thin wrapper around `@pierre/diffs/react`'s `FileDiff` (unified/stacked layout, custom React header via `renderCustomHeader`, sticky via `unsafeCSS`) used by `WriteBlock`/`StrReplaceBlock` in `ToolCallCard.tsx`
- `server/src/modules/stats/` — global stats aggregator (`GET /stats`); iterates all workspaces and merges per-DB aggregates into totals/streaks/hour-histogram/30-day heatmap
- `app/src/features/stats/` + `app/src/components/stats/` — frontend stats hook, API client, types, and `StatsPanel`/`StatCard`/`HourHistogram`/`UsageHeatmap` rendered on the `/` route
- `server/src/modules/conversations/plans/` — plan CRUD, file I/O to `~/.agnt/plans/`, pub/sub for SSE
- `server/src/modules/conversations/tools/write-plan.ts` — `write_plan` tool definition
- `app/src/features/plans/` — plan Zustand store, API client, types, `useAgenticMode` hook, `PlanPanel` component
- `app/src/components/chat/AgenticModeSelector.tsx` — agentic mode switcher in chat input bar

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

- 2026-04-23: Redesigned the home stats into a single compact card. Added `totals.sessions` (conversations count) and `models: {id,label,count}[]` (sorted desc) to `GET /stats`. Extended heatmap window from 30 → 210 days (30 cols × 7 rows) so the new `All`/`30d`/`7d` segmented tabs can slice client-side without re-fetching. Frontend: removed `HourHistogram` component; rewrote `StatsPanel` as a single bordered card with `Overview`/`Models` + `All`/`30d`/`7d` tabs, 4×2 tile grid (Sessions, Messages, Total tokens, Active days, Current streak, Longest streak, Peak hour, Favorite model), blue-scale `UsageHeatmap`, and a playful token-comparison footer. Simplified `StatCard` to an unbordered tile. Tightened the `/` layout (`max-w-xl`, centered) so the card feels compact rather than stretched.
- 2026-04-23: Added global stats dashboard on `/`. New `GET /stats?tzOffsetMinutes=<int>` endpoint (`server/src/modules/stats/`) aggregates user-message activity across every workspace's SQLite DB: totals (messages, tokens, active days), current/longest streaks (computed in JS from merged local-day set), favorite assistant model (argmax of `messages.model_id`), 24-bucket hour-of-day histogram, and a 30-day GitHub-style heatmap. Added `messages.model_id TEXT` column + migration in `server/src/lib/db.ts`; populated via `UPDATE` inside `runStreamTextIntoController` right after `resolveConversationModelSettings` so both `streamReplyToLastMessage` and `streamConversationReply` record the model used for each assistant turn (legacy rows stay NULL and are excluded). SQLite datetime modifier shifts buckets into the client's local timezone via `tzOffsetMinutes` (minutes east of UTC, `-new Date().getTimezoneOffset()`). Frontend: `app/src/features/stats/` (types, API, `useGlobalStats` hook) + `app/src/components/stats/` (`StatsPanel`, `StatCard`, `HourHistogram`, `UsageHeatmap`). Rendered in `app/src/routes/index.tsx` below the heading and above the chat input. Counts user messages only; heatmap is rolling last 30 days, Sun-first. Empty-state copy nudges the user when there's no activity.
- 2026-04-23: Added agentic modes system (`agent`/`plan`). New `server/src/modules/conversations/plans/` with plan CRUD, file I/O to `~/.agnt/plans/`, pub/sub. New `write_plan` ungated tool for plan mode. `buildConversationTools` in `with-permission.ts` now filters tools by `agenticMode` — plan mode restricts to read-only + `write_plan` + shell + question + todo + web tools. `conversation.prompt.ts` injects plan-mode instructions when active. New `plans` SQLite table (migration in `db.ts`). Plan endpoints: `GET/DELETE .../plan`, `POST .../plan/build` (injects todos + switches to agent mode). Frontend: `AgenticModeSelector` in chat input (`Ctrl+Shift+M`), `useAgenticMode` hook, plan Zustand store, `PlanPanel` in right sidebar (new "Plan" tab), `plan-updated` SSE auto-opens sidebar. Build button sends "Build according to the plan" message after injecting todos.
- 2026-04-23: Fixed a context-explosion bug in `await_shell`. The re-emit in `await-shell.ts` (which forwards source-shell output under the await invocation's id for SSE routing) called `emitShellProgress` with the SAME `task_id` it was already subscribed to via `subscribeToJobProgress`, causing the per-job fan-out to recurse into the await listener itself — every call appended `progress.chunk` to `newOutputBuffer` again and re-emitted, until the JS stack overflowed. The bloated buffer was then (a) returned in the `await_shell` tool result, and (b) persisted to `tool_invocations.output_json`. Fixes: (1) new `forwardShellProgressToConversation(event)` in `server/src/modules/conversations/shell/shell.registry.ts` that dispatches to per-conversation listeners only; `await-shell.ts` now uses this for its SSE re-emit. (2) Belt-and-suspenders recursion guard in `emitShellProgress` via a `jobsCurrentlyEmittingProgress: Set<string>` that short-circuits the per-job fan-out for any task_id already mid-dispatch — protects against future callers making the same mistake. (3) Fixed the separate, broader replay bloat: `toolResultOutputFromInvocation` in `conversation.stream.ts` now applies each tool's `toModelOutput` transformer against the stored raw JSON when rebuilding model messages on subsequent turns. Previously `toModelOutput` only ran during the original turn (AI SDK `createToolModelOutput`), so the DB-stored raw output (up to 1 MiB for shell, full old/new file contents for `apply_patch`, etc.) was re-injected unchanged into the prompt on every later turn. `modelOutputToSdk` helper converts our `ToolModelOutput` shape to the AI SDK's `ToolResultOutput`. Async `toModelOutput` on replay falls back to raw JSON with a warning log (every in-tree transformer is sync today). Frontend rendering is unaffected — cards continue to read the raw `ToolInvocation.output` via the conversation fetch payload; the narrowing only applies to the model-bound replay path.
- 2026-04-22: Added `apply_patch` agent tool — OpenAI/Codex V4A diff-envelope format (`*** Begin Patch` / `*** Add File` / `*** Update File` [`*** Move to:`] / `*** Delete File` / `*** End Patch` with `@@` anchors and ` `/`-`/`+` hunk lines). New `server/src/modules/conversations/tools/apply-patch.ts` ships the parser + executor: tolerant normalization (BOM, surrounding ```-fence, `apply_patch <<EOF` heredoc, CRLF), strict envelope validation (errors descriptively on malformed sections, unmatched context, ambiguous matches, anchor-not-found-in-region, `Add File` where target exists, `Update File` / `Delete File` where target is missing), pre-flight pass that reads all originals into memory before writing any file (so a bad hunk aborts without leaving a half-patched tree), per-file CRLF detection + restoration, `Move to:` implemented as write-then-rename with destination-exists guard, auto-created parent dirs reported in `createdDirectories`. Hunk matching narrows the search window via `@@` substring anchors (stackable for nested scopes) then requires the combined ` `/`-` before-text to occur exactly once in that window; pure-prepend hunks with no context are supported. Hard caps 10 MiB per file / 32 MiB per patch. Returns full `{ changes: [{ op, path, relativePath, newPath?, newRelativePath?, oldContents, newContents, linesAdded, linesRemoved, createdDirectories }], summary }` — `toModelOutput` narrows what the model sees to a compact `Applied N files (+a -b):` textual summary so per-file contents don't re-enter the context. Registered in `AGNT_TOOL_DEFS`, wired through `buildConversationTools` to receive `ctx.workspacePath`, NOT in `ALLOW_BY_DEFAULT_TOOL_NAMES` (defaults to `ask`, appears in `Tool permissions` panel). Frontend `ApplyPatchBlock` in `ToolCallCard.tsx` (`GitDiffIcon`) renders one `PierreDiff` per file with per-change op pill + `+N −M` counts; during input streaming it parses the partial `input` via a tolerant `parsePatchForPreview` (same envelope grammar but ignores malformed tails) so the user sees per-file hunks forming as they arrive, and swaps to the authoritative server-returned `oldContents`/`newContents` diffs once the call settles. Tool description explicitly frames `apply_patch` as the preferred mutation tool on Codex/OpenAI models since that format is in their post-training distribution; `write` / `str_replace` remain valid fallbacks. No new deps.
- 2026-04-22: Added `write` and `str_replace` agent tools (server-side only; no frontend yet). New `server/src/modules/conversations/tools/write.ts` creates new files or fully overwrites existing ones; resolves the path through the shared `resolveWorkspacePath` (workspace-containment enforced), auto-creates missing parent dirs and reports them in `createdDirectories`, preserves CRLF line endings when overwriting a file that already used them, and hard-caps writes at 10 MiB. New `server/src/modules/conversations/tools/str-replace.ts` performs exact string replacements in existing text files; enforces uniqueness of `old_string` unless `replace_all: true`, rejects no-op `old===new`, rejects binary files via NUL-byte scan, and transparently normalizes LF-only `old_string`/`new_string` to CRLF when the target file is CRLF so the model can quote text it read through `read_file` (which normalizes to LF). Both tools are registered in `AGNT_TOOL_DEFS`, wired through `buildConversationTools` to receive `ctx.workspacePath`, and NOT added to `ALLOW_BY_DEFAULT_TOOL_NAMES`, so they default to `ask` permission and appear in the `Tool permissions` settings panel via `GET /tools`. No frontend `ToolCallCard` block has been added yet — tool-call rendering falls back to the generic block until the UI is built.
- 2026-04-22: Integrated `@pierre/diffs` (v1.1.16) for the `write` and `str_replace` tool UIs. `app/src/components/chat/PierreDiff.tsx` is a thin wrapper around `FileDiff` from `@pierre/diffs/react`: accepts `path`/`oldContents`/`newContents`, builds a `FileDiffMetadata` via `parseDiffFromFile`, renders in stacked layout (`diffStyle: "unified"`) with the bundled `pierre-dark`/`pierre-light` Shiki themes (`themeType: "dark"`), `diffIndicators: "classic"`, `hunkSeparators: "line-info-basic"`. Pierre's default file header is disabled in favor of a custom React header passed via `renderCustomHeader(fileDiff)`: muted parent directory + `font-semibold text-dark-50` filename on the left (split from `fileDiff.name` / normalized backslashes), right-aligned `+N -M` counts computed from `fileDiff.hunks[].additionLines/deletionLines` (emerald-400 / red-400, `tabular-nums`). `unsafeCSS` targets the `[data-diffs-header='custom']` wrapper Pierre stamps around our slot and promotes it to `position: sticky; top: 0` with `background-color: var(--diffs-bg)` + hairline `color-mix` border-bottom so it pins opaquely to the top of our outer `overflow-auto` scroll container. `WriteBlock` passes `oldContents=""` + `newContents=previewSource` (all lines render as additions), `StrReplaceBlock` passes the raw `old_string`/`new_string`; both still use the workspace-relative `formatReadPath` result as the displayed filename. `ToolBlock.bareChildren` is still required so `PierreDiff` owns its own scroll container. Bun manages the `@pierre/diffs` dep (adds Shiki `^3.0.0` + `diff@8` + `@pierre/theme` transitively).
- 2026-04-21: Aligned Codex request shape with the real Codex CLI to stop busting OpenAI's prompt cache. `conversation.stream.ts` now sends `promptCacheKey = conversationId` on every turn, and `reasoningSummary: "detailed"` is only set when `reasoningEffort` is active. `promptCacheRetention` is intentionally NOT sent — the ChatGPT backend returns 400 "Unsupported parameter: prompt_cache_retention" (that option only exists on the direct OpenAI Platform API; the Codex CLI doesn't set it either). `conversation.prompt.ts` no longer concatenates `todosBlock` into the `instructions`-bound `prompt` string (todos would mutate the cached prefix on every `todo_write`); instead `conversation.stream.ts` appends `prompt.todosBlock` as a trailing `role: "system"` message after `buildModelMessages(...)` so todos remain visible to the model without perturbing the cache. `context.service.ts` accounting is unchanged (it already counts `todosBlock` via a separate `todos` breakdown field and never rolled it into `systemInstructions`). `store: false` stays (matches Codex CLI for ChatGPT-auth; AI SDK auto-adds `include: ["reasoning.encrypted_content"]` for reasoning models in that case).
- 2026-04-21: Added `image_gen` agent tool. New `server/src/modules/conversations/tools/image-gen.ts` posts to `https://chatgpt.com/backend-api/codex/responses` with `tools=[{type:"image_generation",output_format:"png"}]` and `tool_choice={type:"image_generation"}` using the stored Codex OAuth access token (`getValidAccessToken`). Model is resolved from the conversation's effective `activeModel`/`model` when that model has `supportsImageInput: true`, otherwise falls back to `gpt-5.4`; primary-to-`gpt-5.4` retry on backend error. Decoded base64 PNG is saved via `createAttachment` and linked to the current assistant message via `linkAttachmentsToMessage`, so it surfaces through the existing `/workspaces/:id/attachments/:id/content` endpoint. `ConversationPermissionContext` in `permissions/with-permission.ts` gained `getAssistantMessageId?: () => string`, wired from `runStreamTextIntoController` in `conversation.stream.ts` (`() => assistantMsgId`). Tool is gated (defaults to `ask`) and therefore appears in the `Tool permissions` settings panel. Frontend adds `ImageGenBlock` to `ToolCallCard` (ImageIcon, prompt-preview detail, `autoOpen`) that renders the generated image via `resolveAttachmentContentUrl` with a click-to-open-in-new-tab anchor and an optional "Revised prompt" footer. Tool description explicitly tells the model "Do not use if not asked to, cause nobody wants to use their credits for 0 reason."
- 2026-04-20: Added ungated `todo_write` agent tool + per-conversation todo system. New `todos` SQLite table (cascade-on-conversation-delete) with `pending`/`in_progress`/`completed`/`cancelled` statuses. New `server/src/modules/conversations/todos/` (service with atomic replace + pub/sub) and `server/src/modules/conversations/tools/todo-write.ts` (ungated, single in_progress enforced). `conversation.prompt.ts` now accepts `conversationId` and injects a `## Current Todos` block via `buildTodosPromptBlock` so the model sees its plan every turn. `conversation.stream.ts` subscribes to the todos pub/sub and emits a `todos-updated` SSE event (`{ conversation_id, todos }`); permission ctx now also carries `workspaceId` so the tool can resolve its DB. New `GET /workspaces/:id/conversations/:conversationId/todos`. `/context` breakdown gains a `todos` field; `ContextMeter` renders the row when non-zero. Frontend: new `app/src/features/todos/` (types, API, Zustand store with `todosByConversationId` + collapsed map). `TodosCard.tsx` exists but is not mounted anywhere by default (kept as an opt-in pinned/collapsible view); the live progress UI is the inline `TodoWriteBlock` in `ToolCallCard` only. `ToolCallCard` gains `TodoWriteBlock` (ListChecksIcon, `done/total` detail, expandable list with strike-through). Conversation store handles the `todos-updated` SSE and clears todos on conversation delete.
- 2026-04-20: Added ungated `question` agent tool + UI. Server: new `server/src/modules/conversations/questions/gate.ts` (request/resolve/abort/clear — mirror of permissions gate but returns `string[][]` answers), new `server/src/modules/conversations/tools/question.ts` with zod schema matching the OpenCode-style signature (`questions: [{ question, header≤30, options: [{ label, description }], multiple }]`), new `UNGATED_TOOL_NAMES` set in `tools/index.ts` so `question` bypasses `wrapExecute` in `buildConversationTools`. `conversation.stream.ts` now subscribes to the questions gate, emits `questions-required`/`questions-resolved` SSE, and calls `abortQuestions` alongside `abortPermissions` on abort/error paths. New endpoint `POST /workspaces/:id/conversations/:conversationId/questions/:requestId/respond` with `{ answers: string[][] }`. `GET /tools` now filters out ungated tools so `question` does not appear in `Tool permissions`. Frontend: new `app/src/features/questions/` (types, API, Zustand store) + `app/src/components/chat/QuestionCard.tsx` (stacked scrollable card with selectable option pills, dashed "Type your own" pill that reveals an inline input, single Submit gated on every question having an answer). `ChatInput` renders `QuestionCard` with priority over `PermissionCard`. Conversation store handles both new SSE events and clears question-state alongside permission-state on finish/abort/error/switch/delete/stop. `ToolCallCard` gains a `QuestionBlock` (ChatTeardropDotsIcon) that renders historical `question` tool invocations with per-question answer chips.
- 2026-04-04 to 2026-04-18: Initial repo contract, Codex OAuth/SSE streaming, stop-generation abort wiring, workspace/conversation state history, model selection; first agent tool framework (`read_file`, `tool_invocations` table, `tool-call`/`tool-result` SSE); `glob`/`grep` tools + shared `workspace-path.ts` containment resolver; context meter + auto-compaction pipeline (`context.service.ts`, `compact.service.ts`, `context.attachments.ts`, per-message token columns, 85% threshold, `finish.usage`/`compacted` SSE, `ContextMeter` UI); tool permission system (`toolPermissions` settings category, `permissionMode` state, `AGNT_TOOL_DEFS`/`buildConversationTools`, `permission-required`/`permission-resolved` SSE, `Tool permissions` settings panel, `PermissionCard`); workspace repo-instruction injection (`repo-instructions.ts`, `GET /workspaces/:id/repo-instructions`, Repo-instructions settings panel); removed unused `general` settings category.
- 2026-04-19: Changed tool permission defaults to an explicit allow-by-default built-in allowlist (`read_file`, `glob`, `grep`, `use_skill`); unlisted future tools default to `ask`.
- 2026-04-19: Added automatic conversation title generation via OpenRouter (`conversation-title.ts`, default `qwen/qwen3.5-9b` overridable via `OPENROUTER_TITLE_MODEL`, auth via `OPENROUTER_API_KEY`). Kicked off on first turn when title is still the placeholder; emits `conversation-title` SSE and persists only when the title has not been user-edited. Titles trimmed to ≤60 chars with only the first character uppercased.
- 2026-04-19: Added skill system + `use_skill` tool. `server/src/modules/skills/skills.service.ts` discovers `SKILL.md` playbooks from `~/.agnt/skills` + `~/.agents/skills` + `~/.claude/skills` and workspace `.agnt/skills` / `.agents/skills` / `.claude/skills` (project overrides user on name collision). `conversation.prompt.ts` injects an `<available_skills>` block; `use_skill(name)` returns `{ ok: true, name, description, source, directory, content, files }` or `{ ok: false, error, requested, available }`. `ToolCallCard` renders a `UseSkillBlock`.

---

## Quick pre-PR checklist
- [ ] No generated files manually edited
- [ ] Runtime mode assumptions (port/auth/startup) still coherent
- [ ] AGENTS.md updated if workflow/contracts changed
- [ ] Health/readiness behavior remains accurate
- [ ] New env vars documented here
- [ ] Commands in this file still run as documented
