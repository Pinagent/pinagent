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

| Tool                    | Purpose                                                              |
| ----------------------- | -------------------------------------------------------------------- |
| `list_pending_feedback` | List pending items, optionally filtered by `since` / `file`.         |
| `get_feedback`          | Full record incl. screenshot as an image content block.              |
| `resolve_feedback`      | Set status to `fixed` / `wontfix` / `deferred` (or back to pending). |
| `get_source_context`    | Return a numbered window of source lines around a `file:line`.       |

## Channel mode (push events into a running Claude Code session)

The server also declares the `claude/channel` capability ([research preview](https://code.claude.com/docs/en/channels)). When Claude Code is launched with the channel flag, the server watches `.pinagent/feedback/` and pushes a `notifications/claude/channel` event for each new comment so the agent reacts in your existing session instead of being polled.

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
