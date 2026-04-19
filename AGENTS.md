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

### Conversation storage (SQLite)
- Each workspace has a SQLite database at `~/.agnt/workspaces/<workspaceId>/conversations.db`.
- Tables: `conversations` (id, title, created_at, updated_at), `messages` (id, conversation_id, role, content, persisted reasoning fields `reasoning_content`/`reasoning_started_at`/`reasoning_ended_at`, token columns `input_tokens`/`output_tokens`/`reasoning_tokens`/`total_tokens`, `compacted` flag, `summary_of_until` for compacted summary rows), `attachments` (adds `estimated_tokens`), `state_entries` (latest workspace/conversation key-value state), `history_entries` (append-only workspace/conversation state history), and `tool_invocations` (id, message_id, tool_name, input_json, output_json, error, status, created_at) linked to assistant messages with cascade delete.
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
- `conversation.stream.ts` builds a per-conversation tool set via `buildConversationTools({ conversationId, mode })` (`server/src/modules/conversations/permissions/with-permission.ts`) which wraps each definition's `execute` through `withPermission`, EXCEPT for tools listed in `UNGATED_TOOL_NAMES` (currently `question`), whose `execute` is passed through unwrapped. The tools are passed to `streamText` with `stopWhen: stepCountIs(5)`.
- Permission gate: each tool call is decided by (1) conversation permission mode (`ask`/`bypass`, effective-state key `permissionMode`), (2) the per-tool setting from the `toolPermissions` settings category (`ask`/`allow`/`deny`), and (3) the in-memory session-allow cache (`allow_session` decisions). Allow-by-default built-ins are explicitly listed in code (`read_file`, `glob`, `grep`, `use_skill`); unlisted future tools default to `ask`. `deny` short-circuits with an error. `ask` routes through `requestPermission` which returns a promise resolved by the frontend. Ungated tools skip this whole flow.
- Tool invocations are persisted in `tool_invocations`: a row is inserted on `tool-call` (status `pending`) and updated on `tool-result` (`success`) / `tool-error` (`error`). Pending rows are marked `error` when the stream aborts or errors.
- SSE protocol events: `tool-call`, `tool-result`, plus permission events `permission-required` (`{ id, messageId, toolName, input, createdAt }`) and `permission-resolved` (`{ id, messageId, decision }`), plus question events `questions-required` (`{ id, messageId, questions, createdAt }`) and `questions-resolved` (`{ id, messageId, answers }`). Each carries `messageId` so the frontend attaches them to the right assistant message. `Message.tool_invocations` is part of the conversation fetch payload.
- Permission HTTP endpoint: `POST /workspaces/:id/conversations/:conversationId/permissions/:requestId/respond` with `{ decision: "allow_once" | "allow_session" | "deny" }`. Deleting a conversation also calls `clearConversationPermissionState` to reject pending requests and clear the session-allow cache.
- Question HTTP endpoint: `POST /workspaces/:id/conversations/:conversationId/questions/:requestId/respond` with `{ answers: string[][] }` (one inner array per question, each containing 1+ selected labels or custom-typed strings). Server validates shape, cardinality, and single-select constraints. Deleting a conversation also calls `clearConversationQuestionState` to reject pending requests.
- Tool listing endpoint: `GET /tools` returns `[{ name, description }]` used by the settings panel. Ungated tools (e.g. `question`) are filtered out of this listing so they never show in `Tool permissions`.
- Current tool set:
  - `read_file(path, maxBytes?)` — reads a utf-8 file. Accepts absolute paths, workspace-root-relative paths (leading `/` or `\`), or paths relative to the workspace. Rejects binary (NUL-byte scan), default 256KB cap, hard cap 1MB. Located at `server/src/modules/conversations/tools/read-file.ts`.
  - `glob(pattern, path?, limit?)` — finds files by glob pattern inside the workspace. Path rules follow `read_file`, but absolute paths are only accepted if they live inside the workspace (containment enforced via `resolveWorkspacePath`). Default ignore list prunes `node_modules`, `.git`, `dist`, `build`, `.next`, `target`, `out`, `.venv`, `venv`, `__pycache__`, `coverage`, editor caches, etc. Default limit 100, hard cap 500, hard cap 50k dir entries scanned. Located at `server/src/modules/conversations/tools/glob.ts`.
  - `grep(pattern, path?, include?, caseInsensitive?, maxResults?)` — regex search over workspace files. Shares path/containment rules and ignore list with `glob`. Skips symlinks, binary files (NUL-byte scan), empty files, and files >1MB; global scan cap 50MB total and 50k dir entries. Default 100 matches, hard cap 1000; lines truncated at 400 chars. Located at `server/src/modules/conversations/tools/grep.ts`.
  - `use_skill(name)` — loads a skill playbook by name from the discovery roots listed under **Skills** above. Skill list for the current stream is injected via `createUseSkillToolDef(() => skills)` in `buildConversationTools`. Located at `server/src/modules/conversations/tools/use-skill.ts`.
  - `question({ questions: [{ question, header (≤30 chars), options: [{ label, description }], multiple }] })` — ungated UI tool. Presents one or more multiple-choice questions in the chat input (replacing it, same UX pattern as the permission card) and blocks until the user answers. A "Type your own answer" pill is always rendered client-side, so the model must NOT include catch-all options like "Other"; if an option is recommended, put it first and append ` (Recommended)` to its label. Returns `{ answers: string[][] }` — each inner array is the selected option labels (or the user-typed custom string) for the matching question; even single-select answers come back as a 1-element array. Located at `server/src/modules/conversations/tools/question.ts`; blocks on `requestQuestions` from `server/src/modules/conversations/questions/gate.ts`. This tool bypasses the permission gate entirely and is hidden from the `Tool permissions` settings panel.
  - Workspace-containment + ignored-dir logic lives in `server/src/modules/conversations/tools/workspace-path.ts` and is shared across filesystem-walking tools.
- Frontend renders tool calls as `ToolCallCard` (`app/src/components/chat/ToolCallCard.tsx`) inside the assistant bubble. Pending permission requests are surfaced by the `PermissionCard` above the chat textarea and the sidebar swaps `MinusIcon` for a pulsing `ShieldWarningIcon` on the affected conversation. Pending question requests are surfaced by `QuestionCard` (`app/src/components/chat/QuestionCard.tsx`) which takes priority over `PermissionCard` when both are active and renders all questions in one stacked scrollable card with selectable option pills, a dashed "Type your own" pill that reveals an input, and a single Submit button gated on every question having at least one answer. Mode is toggled via `PermissionModeSelector` next to the model selector. Per-tool defaults live in the new `Tool permissions` settings category.

### Context metering + auto-compaction
- Server-authoritative token usage: AI SDK `streamText` `onFinish` persists `input_tokens`/`output_tokens`/`reasoning_tokens`/`total_tokens` to `messages` and emits a `finish` SSE event with `usage` for the just-completed assistant turn.
- `GET /workspaces/:id/conversations/:conversationId/context` returns `{ modelId, contextWindow, maxOutputTokens, usedTokens, percent, breakdown: { messages, reasoning, toolOutputs, attachments, repoInstructions, systemInstructions }, messageCount, compactedMessageCount, hasCompactSummary, lastCompactedAt, autoCompactThreshold }`. Attachment tokens use stored `estimated_tokens` (fallback re-estimation for legacy rows): text tokenized via `gpt-tokenizer` o200k_base, images = 1105 per image, PDFs ≈ bytes/3. `repoInstructions` tracks injected `AGENTS.md` / `CLAUDE.md` prompt content separately from the base system prompt.
- Auto-compaction: before handling a new user turn in `conversation.stream.ts`, if projected usage crosses `COMPACT_THRESHOLD` (0.85), `compactConversation` summarizes all messages older than the last 6 (3 user/assistant pairs) plus always keeps the most recent user message; older rows are marked `compacted=1`, a single system message with `summary_of_until=<last summarized id>` holding the summary is inserted, and a `compacted` SSE event is emitted with `{ summaryMessageId, summarizedMessageIds, summarizedCount, usedTokensAfter, summaryContent, summaryCreatedAt, summaryOfUntil }`.
- `POST /workspaces/:id/conversations/:conversationId/compact` triggers the same pipeline manually (from the meter popover at ≥85%).
- History queries for model prompting filter `compacted=0`; the system summary row is included verbatim. The conversation fetch payload exposes the new columns so the UI can render a compact banner + collapsible summary in `MessageList`.
- Frontend: `app/src/features/context/` provides `useContextMeter` (merges server summary with client-side tokenization of the draft via `gpt-tokenizer` and pending attachment token estimates). `ContextMeter.tsx` renders an 18px SVG ring with `strokeLinecap="butt"`, color tiers, tooltip breakdown, and a popover at ≥85% that calls `/compact`. Mounted immediately left of the send/stop button in `ChatInput`.
- Deps: `gpt-tokenizer` added to both `server/` and `app/`.

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

- 2026-04-20: Added ungated `question` agent tool + UI. Server: new `server/src/modules/conversations/questions/gate.ts` (request/resolve/abort/clear — mirror of permissions gate but returns `string[][]` answers), new `server/src/modules/conversations/tools/question.ts` with zod schema matching the OpenCode-style signature (`questions: [{ question, header≤30, options: [{ label, description }], multiple }]`), new `UNGATED_TOOL_NAMES` set in `tools/index.ts` so `question` bypasses `wrapExecute` in `buildConversationTools`. `conversation.stream.ts` now subscribes to the questions gate, emits `questions-required`/`questions-resolved` SSE, and calls `abortQuestions` alongside `abortPermissions` on abort/error paths. New endpoint `POST /workspaces/:id/conversations/:conversationId/questions/:requestId/respond` with `{ answers: string[][] }`. `GET /tools` now filters out ungated tools so `question` does not appear in `Tool permissions`. Frontend: new `app/src/features/questions/` (types, API, Zustand store) + `app/src/components/chat/QuestionCard.tsx` (stacked scrollable card with selectable option pills, dashed "Type your own" pill that reveals an inline input, single Submit gated on every question having an answer). `ChatInput` renders `QuestionCard` with priority over `PermissionCard`. Conversation store handles both new SSE events and clears question-state alongside permission-state on finish/abort/error/switch/delete/stop. `ToolCallCard` gains a `QuestionBlock` (ChatTeardropDotsIcon) that renders historical `question` tool invocations with per-question answer chips.
- 2026-04-04 to 2026-04-16: Initial repo contract, Codex OAuth/SSE streaming, stop-generation abort wiring, workspace/conversation state history, model selection, and first agent tool framework (`read_file`, `tool_invocations` table, `tool-call`/`tool-result` SSE).
- 2026-04-19: Changed tool permission defaults to use an explicit allow-by-default built-in allowlist (`read_file`, `glob`, `grep`, `use_skill`). Those entries are seeded into settings as `allow`; unlisted future tools default to `ask` until explicitly configured.
- 2026-04-18: Added workspace repo-instruction injection. Server now resolves `AGENTS.md` / `CLAUDE.md` / `.agents/AGENTS.md` / `.claude/CLAUDE.md` via `server/src/modules/conversations/repo-instructions.ts`, injects them into the composed system prompt from `conversation.prompt.ts`, exposes `GET /workspaces/:id/repo-instructions`, and counts repo-instruction tokens separately in `/context`. Frontend adds a `Repo instructions` settings panel and shows repo-instruction usage in `ContextMeter`.
- 2026-04-18: Removed the unused `general` settings category and its three toggles from the app. Settings UI now opens on `Hotkeys`, server/global settings only support `hotkeys` and `toolPermissions`, and legacy keys are stripped from `~/.agnt/settings.json` on load.
- 2026-04-17: Added context meter + auto-compaction. Server: new `context.service.ts` (`GET /context` with breakdown), `compact.service.ts` (`POST /compact`), `context.attachments.ts` (token estimator: text tokenized, images=1105, PDF≈bytes/3), `conversation.constants.ts` (shared DEFAULT_MODEL/SYSTEM_INSTRUCTIONS), `lib/mime-detect.ts` (shared MIME helpers), `lib/tokenizer.ts` wrapping `gpt-tokenizer` o200k_base. `messages` gains `input_tokens`/`output_tokens`/`reasoning_tokens`/`total_tokens`/`compacted`/`summary_of_until`; `attachments` gains `estimated_tokens`. `streamText` onFinish persists usage; auto-compaction runs pre-stream at 85% threshold (keeps last 6 + last user, summarizes older into a `role=system` row). New SSE events: `finish.usage`, `compacted`. Frontend: new `app/src/features/context/` (types, API, client tokenizer, `useContextMeter`), new `ContextMeter.tsx` (18px SVG ring with butt stroke caps + tooltip/popover) mounted left of send in `ChatInput`, `MessageList` renders compact banner + collapsible summary for compacted history. Store handles `finish.usage`/`compacted` events and maintains `contextByConversationId`. Deps: added `gpt-tokenizer` to app + server.
- 2026-04-17: Added tool permission system. Server: new `server/src/modules/conversations/permissions/` (in-memory gate + `withPermission`/`buildConversationTools` adapter), new `toolPermissions` settings category (`ask`/`allow`/`deny` per tool), new `permissionMode` conversation effective-state key (`ask`/`bypass`), new SSE events `permission-required`/`permission-resolved`, new `POST /workspaces/:id/conversations/:conversationId/permissions/:requestId/respond` endpoint, new `GET /tools` catalog endpoint; tool registry now exports `AGNT_TOOL_DEFS` (raw definitions) instead of pre-wrapped `AGNT_TOOLS`. Frontend: new `app/src/features/permissions/` (Zustand pending-request store + `usePermissionMode` hook + tools API), new `PermissionModeSelector` and `PermissionCard` in chat input, sidebar pulses `ShieldWarningIcon` for conversations awaiting approval, new `Tool permissions` settings panel.
- 2026-04-19: Added automatic conversation title generation. Server: new `server/src/modules/conversations/conversation-title.ts` calls OpenRouter via `@openrouter/ai-sdk-provider` (default model `qwen/qwen3.5-9b`, overridable via `OPENROUTER_TITLE_MODEL`, auth via `OPENROUTER_API_KEY`). `conversation.constants.ts` now also exports `DEFAULT_CONVERSATION_TITLE`, `DEFAULT_TITLE_GENERATION_MODEL`, `MAX_CONVERSATION_TITLE_LENGTH`. `conversation.stream.ts` kicks off title generation (only when the title is still the default placeholder) at the start of both `streamReplyToLastMessage` and `streamConversationReply`, emits a new SSE event `conversation-title` (`{ conversation_id, title, updated_at }`) when it resolves, and persists the new title only if it still matches the placeholder. Titles are trimmed to ≤60 chars and formatted so only the first character is uppercased (rest preserves original casing for proper nouns/acronyms/identifiers). If the key is not set, title generation is skipped silently. Frontend: conversation store handles the `conversation-title` SSE event and updates both `conversationsById` and `conversationsByWorkspace` so the sidebar entry updates live. New env vars in `server/.env`.
- 2026-04-19: Added skill system + `use_skill` tool. New `server/src/modules/skills/skills.service.ts` discovers `SKILL.md` playbooks from the user's `~/.agnt/skills`, `~/.agents/skills`, `~/.claude/skills` and the workspace's `.agnt/skills`, `.agents/skills`, `.claude/skills` (project overrides user on name collision). `conversation.prompt.ts` now injects an `<available_skills>` block listing each skill's name/description into the system prompt, and `conversation.stream.ts` passes the discovered list through `buildConversationTools({ getSkills })` so the new `use_skill(name)` tool resolves against the active set. The tool returns either `{ ok: true, name, description, source, directory, content, files }` or `{ ok: false, error, requested, available }` without throwing. Added `GET /workspaces/:id/skills` for inspection. Frontend `ToolCallCard` renders a `UseSkillBlock` (BookOpenText icon) with `name · <fileCount> files` detail and an expandable description + file listing; not-found results are surfaced in the error style.
- 2026-04-18: Added `glob` and `grep` tools. New shared `server/src/modules/conversations/tools/workspace-path.ts` (workspace-containment path resolver + ignored-dir segment list) used by both tools. `buildConversationTools` now dispatches on tool name to inject the workspace path into `glob`/`grep`/`read_file` factories. Both new tools require an open workspace, refuse absolute paths outside the workspace, prune common vendor/cache dirs during traversal, and cap result counts, bytes scanned, and dir entries walked. Frontend `ToolCallCard` renders `glob` (FilesIcon) and `grep` (MagnifyingGlassIcon) with pattern/match-count detail and a collapsible list of matches. New tools automatically surface in the `Tool permissions` settings panel via `GET /tools`.

---

## Quick pre-PR checklist
- [ ] No generated files manually edited
- [ ] Runtime mode assumptions (port/auth/startup) still coherent
- [ ] AGENTS.md updated if workflow/contracts changed
- [ ] Health/readiness behavior remains accurate
- [ ] New env vars documented here
- [ ] Commands in this file still run as documented
