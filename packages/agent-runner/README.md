# @pinagent/agent-runner

Server-side runtime for Pinagent. Spawns Claude Agent SDK sessions per comment in isolated git worktrees, streams progress to host pages over WebSocket, and owns the persistent state (SQLite via `@pinagent/db`) that the dock and widget read from.

Consumed by `@pinagent/vite-plugin` and `@pinagent/next-plugin` — those packages adapt this runtime to their respective dev-server middleware. Adopters never import from this package directly.

## What lives here

| Module                    | Role                                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `agent.ts`                | Spawns SDK sessions (`spawnAgent`, `runFollowUpTurn`), worktree lifecycle (`mergeWorktree`, `discardWorktree`).      |
| `ws-server.ts`            | `/__pinagent/ws` WebSocket — replays transcript-so-far, then streams live events. Default port `53636`.             |
| `storage.ts`              | `Storage` — feedback CRUD over SQLite + on-disk transcripts. Source of truth for conversations.                     |
| `bus.ts`                  | SQLite-backed per-conversation event bus. Survives module re-evaluation across Vite/Next contexts.                  |
| `merge-queue.ts`          | Per-project FIFO queue so two widgets racing to land onto the same branch can't interleave.                         |
| `audit-log.ts`            | Append-only audit trail (`conversation_landed`, `pr_created`, …). Best-effort writes — never masks the real action. |
| `conversation-patch.ts`   | Diff-aware patch for rename + archive; emits `conversation_renamed` / `_archived` / `_unarchived` audit events.     |
| `pr-composer.ts`          | Compose multiple resolved worktrees into one branch + open the GitHub PR.                                           |
| `changes.ts`              | Per-conversation diff stats + unified diffs for the dock's Changes view.                                            |
| `branches.ts`             | List + prune worktrees for the dock's Branches view.                                                                |
| `history.ts`              | Full-text search over resolved conversations.                                                                       |
| `secrets-store.ts`        | `.pinagent/secrets.json` (gitignored) — stores the GitHub PAT + Anthropic API key.                                  |
| `settings-store.ts`       | `.pinagent/settings.json` — base branch, retention, cost caps, permission mode.                                     |
| `connection-validators.ts`| Validates GitHub + Anthropic credentials upstream before persisting.                                                |
| `ask-user.ts`             | In-process MCP server exposing the `ask_user` tool — bridges the agent's question to the dock's reply UI.           |
| `editor.ts`               | Open `file:line:col` in the user's editor. Honours `PINAGENT_EDITOR` / `EDITOR` / `VISUAL`; falls back to `code`.    |
| `worktree-ttl.ts`         | Background sweeper that prunes worktrees past their retention window.                                               |

## Conversation lifecycle

1. **Submit** — host plugin's `POST /__pinagent/feedback` calls `Storage.create`, which writes the conversation row and emits `conversation_created` on the audit log + a `ProjectEvent` on the bus.
2. **Spawn** — the plugin calls `spawnAgent(record)`. Mode is one of:
   - `worktree` — checkout a fresh branch in `.pinagent/worktrees/<id>/`, run the SDK there (default).
   - `inline` — run against the user's working tree (no worktree). Used when `spawnMode: 'inline'` is configured.
   - `false` — don't spawn at all; conversation stays at status `pending`.
3. **Stream** — every SDK event is rendered (`agent-render.ts`) and published to the per-conversation bus. The WS server replays the transcript so-far on subscribe, then streams live.
4. **Ask** — the agent calls the `ask_user` MCP tool. The runtime correlates by `askId` so the widget's reply resolves the correct promise.
5. **Resolve** — agent calls `resolve_feedback`. Run finishes; the row's status flips.
6. **Land / Discard** — user clicks Land in the widget or dock. `mergeWorktree` / `discardWorktree` run through `merge-queue.ts` so concurrent lands serialise. Audit events emit on transition.

## WebSocket protocol

Wire types live in `@pinagent/shared`:

- **`ClientMessage`** — `subscribe`, `unsubscribe`, `sendMessage`, `answerAsk`, `land`, `discard`, `interrupt`.
- **`ServerMessage`** — `event` (per-conversation `AgentEvent`), `worktreeState` (lifecycle transitions), `projectEvent` (cross-conversation changes), `connectionStatus`.

The WS server picks `DEFAULT_PORT` (53636) and falls back to adjacent ports if it's taken. The SQLite-backed bus polls at ~100ms — that's the floor for event latency.

## Settings + secrets

Both live under `.pinagent/` in the project root and are gitignored.

- **`secrets.json`** — `{ github?: { token, login? }, anthropic?: { key } }`. Validated upstream before write (GitHub `/user`, Anthropic `/v1/messages`). The GitHub token drives `pr-composer.ts`; the Anthropic key is injected into spawned agent processes as `ANTHROPIC_API_KEY`.
- **`settings.json`** — `{ baseBranch, worktreeRetentionDays, perConversationCapUsd, monthlyBudgetUsd, permissionMode }`. `permissionMode` controls how the SDK handles tool calls (`auto` / `approve` / `dry-run`).

## Build

```bash
pnpm --filter @pinagent/agent-runner build
```

Produces ESM + CJS under `dist/` via `tsdown`. Node-only — no browser bundling. The plugin packages import compiled output.
