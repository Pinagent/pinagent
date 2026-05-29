# @pinagent/mcp

stdio MCP server that exposes Pinagent feedback to a coding agent.

## Install

```bash
npx @pinagent/mcp
# or with an explicit root
PINAGENT_PROJECT_ROOT=/path/to/repo npx @pinagent/mcp
```

The server walks up from `cwd` looking for `.pinagent/` (then `package.json`) if `PINAGENT_PROJECT_ROOT` is unset, and logs the resolved root on startup.

## Claude Code config

```json
{
  "mcpServers": {
    "pinagent": {
      "command": "npx",
      "args": ["@pinagent/mcp"],
      "env": { "PINAGENT_PROJECT_ROOT": "${workspaceFolder}" }
    }
  }
}
```

## Tools

| Tool                          | Purpose                                                                |
| ----------------------------- | ---------------------------------------------------------------------- |
| `list_pending_feedback`       | List pending items, optionally filtered by `since` / `file`.           |
| `get_feedback`                | Full record incl. screenshot as an image content block.                |
| `resolve_feedback`            | Set status to `fixed` / `wontfix` / `deferred` (or back to pending).   |
| `get_source_context`          | Return a numbered window of source lines around a `file:line`.         |
| `get_conversation_transcript` | Fetch the full persisted agent transcript for one conversation.        |

### `get_conversation_transcript`

Inputs: `{ id: string, format?: 'text' | 'json' }`. Defaults to `text` —
the same plain rendering `pinagent transcript` produces, so a spawned
agent reading a prior run sees identical output regardless of which
surface they came through. `json` returns the raw `AgentEvent[]`
stringified for downstream parsing.

The transcript includes `init` / `result` events (the agent wants
them for full context) and excludes the internal `__finished` bus
sentinel. Reads directly from the `.pinagent/db.sqlite` `messages`
table — no HTTP round-trip; same data the dock's transcript prefetch
sees. Returns `[]` for invalid or unknown ids; `404`-style "not
found" errors only fire when the conversation row itself is missing.

Use it when an agent needs memory of its own prior runs (or another
agent's) — for example, to reason about a follow-up turn after the
user re-opens a landed conversation.

## Channel mode (push events into a running Claude Code session)

The server also declares the `claude/channel` capability ([research preview](https://code.claude.com/docs/en/channels), requires Claude Code **v2.1.80 or later**). When Claude Code is launched with the channel flag, the server polls the local SQLite store and pushes a `notifications/claude/channel` event for each new comment so the agent reacts in your existing session instead of being polled.

Launch the session with both the project-scoped MCP config *and* the channel development flag:

```bash
cd your-project-with-pinagent
claude --dangerously-load-development-channels server:pinagent
```

The `server:pinagent` argument matches the key in your `.mcp.json`. Events arrive in Claude's context as:

```text
<channel source="pinagent" id="..." file="src/Foo.tsx" line="42" col="7" ...>
  the developer's comment
</channel>
```

If you don't pass the flag, channel notifications are silently dropped and the pull-mode tools above continue to work normally.

**Only comments left *after* the session starts are pushed.** The watcher seeds itself with the IDs already in the store at boot and pushes events for items that arrive afterwards, so a backlog of comments queued *before* you launched the session won't trigger channel events. Reach those with the pull-mode tools (`list_pending_feedback` / `get_feedback`).
