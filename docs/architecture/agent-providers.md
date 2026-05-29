<!-- SPDX-License-Identifier: Apache-2.0 -->
# Agent providers — bring your own model

Pinagent's spawn mode (one agent per submitted comment, streaming back
into the widget) runs behind a small **provider** abstraction so the
coding agent isn't hard-wired to any one backend. The default is the
Claude Agent SDK; a wrapped CLI is the opt-in "bring your own model"
path.

This complements the *other* already-model-agnostic surface: the
`@pinagent/mcp` server. Any MCP-capable client (Claude Code, Cursor,
Cline, Codex, …) can connect to it via `.mcp.json` and drive the queue
manually. Providers are about the **automatic** per-comment agent.

## The seam

Everything downstream of a run — the widget stream, the WebSocket bus,
the transcript log, and the persisted cost/session rollups in
`storage.ts` — speaks Pinagent's own `AgentEvent` union
(`@pinagent/shared`), never a backend-specific message type. A provider's
only job is to translate its backend into that union.

```
            ┌──────────────────────────────────────────┐
 runQuery   │ provider.run(req): AsyncIterable<          │
 (agent.ts) │                       ProviderRunItem>     │
            └───────────────┬──────────────────────────┘
                            │  events: AgentEvent[]   (→ bus → widget + cost/session)
                            │  log:    string         (→ .pinagent/logs/<id>.md)
                            │  sessionId / resultFooter
                            ▼
            consumeStream  — backend-neutral: publishes, logs, persists,
                             writes the resolution block.
```

Because cost (`result.totalCostUsd`), session id (`init.sessionId`), and
billing source (`init.apiKeySource`) all ride through `AgentEvent`s into
the `messages` table, a provider gets the dock's cost badge, cost caps,
and follow-up/resume plumbing "for free" just by emitting a well-formed
`init` and terminal `result` event.

See `packages/agent-runner/src/providers/`:

- `types.ts` — `AgentProvider`, `AgentRunRequest`, `ProviderRunItem`.
- `claude-code.ts` — the default. Wraps `@anthropic-ai/claude-agent-sdk`'s
  `query()` and maps `SDKMessage` → `AgentEvent`.
- `cli.ts` — wraps an arbitrary agentic CLI.
- `index.ts` — `resolveProvider(env)` / `resolveProviderId(env)`.

## Selecting a provider

`PINAGENT_AGENT_PROVIDER` chooses the backend, defaulting to
`claude-code` so existing setups are unaffected:

| value         | backend                                            |
| ------------- | -------------------------------------------------- |
| _unset_       | `claude-code` (default)                            |
| `claude-code` | Claude Agent SDK                                   |
| `cli`         | wrapped CLI (see below)                            |

## The CLI provider

`PINAGENT_AGENT_PROVIDER=cli` shells out to a coding-agent CLI you
choose. The wrapped CLI owns its own agentic loop and edits files
directly in the run's working directory (the project root, or an
isolated worktree in worktree mode) — exactly where the Claude provider's
edits land. Pinagent streams the CLI's stdout into the widget.

Configuration (all read per-run, so no dev-server restart needed):

| env var                       | default            | meaning                                                                 |
| ----------------------------- | ------------------ | ----------------------------------------------------------------------- |
| `PINAGENT_AGENT_CLI_COMMAND`  | _(required)_       | JSON array (`["aider","--yes-always"]`) or space-separated string.      |
| `PINAGENT_AGENT_CLI_PROMPT`   | `arg`              | `arg` appends the prompt as the final argv; `stdin` pipes it to stdin.  |
| `PINAGENT_AGENT_CLI_FORMAT`   | `text`             | `text` = each stdout line is narration; `stream-json` = parse per-line. |
| `PINAGENT_AGENT_CLI_MODEL`    | the executable name | label for the widget's model chip.                                     |

The child inherits the parent environment plus `PINAGENT_PROJECT_ROOT`,
`PINAGENT_FEEDBACK_ID`, and `PINAGENT_RESUME_SESSION`, so an MCP-aware
CLI (or a wrapper script) can connect to the `@pinagent/mcp` server,
call `get_feedback` to read the comment + screenshot, and call
`resolve_feedback` when done.

### Output formats

- **`text`** — every non-blank stdout line becomes a `text` event;
  stderr is surfaced too (tagged `[stderr]`). Simplest; works with any
  CLI.
- **`stream-json`** — each line is parsed as JSON and mapped against a
  pragmatic subset of common agent shapes: `{ text }`, `{ content }`,
  `{ delta }`/`{ delta: { text } }`, Anthropic-style
  `{ message: { content: [...] } }`, and lone
  `{ type: "tool_use"|"tool_call", name, input }`. Unparseable lines fall
  back to raw text so output is never silently dropped.

### What you give up vs. the Claude provider

A wrapped CLI is "bring your own *agent loop*", not just a model swap, so
some niceties are backend-dependent:

- **Cost** is reported as `0` (most CLIs don't emit it). Cost caps still
  gate on turns elapsing per conversation.
- **Resume** is passed as `PINAGENT_RESUME_SESSION`; whether a follow-up
  actually continues the prior session depends on the CLI honouring it.
- **`ask_user`** (the mid-run "ask the human" tool) and **permission
  gating** are SDK features; a wrapped CLI uses its own approval flags
  (`PINAGENT_AGENT_CLI_COMMAND` is where you'd pass `--yes`-style flags).
- **`resolve_feedback`** only happens automatically if the CLI is
  MCP-aware and calls it; otherwise resolve the comment from the dock.

## Adding a new provider

1. Implement `AgentProvider` in `packages/agent-runner/src/providers/`.
   `run()` is an async generator yielding `ProviderRunItem`s; honour
   `req.abortSignal`.
2. Emit an `init` event (with `sessionId` + `apiKeySource`) and a
   terminal `result` event (with `totalCostUsd` + `numTurns`) so the
   dock's badges and cost caps work.
3. Register the id in `ProviderId`, `createProvider`, and
   `resolveProviderId` in `index.ts`.
4. Re-export public types from `packages/agent-runner/src/index.ts`.
