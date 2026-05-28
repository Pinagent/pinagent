# @pinagent/cli

Thin command-line wrapper around the Pinagent OSS packages. Installs the `pinagent` binary.

## Install

The CLI ships from the npm registry as `@pinagent/cli`. The common pattern is to invoke it without a global install:

```bash
pnpm dlx @pinagent/cli <subcommand>
npx @pinagent/cli <subcommand>
```

A global install also works (`pnpm add -g @pinagent/cli`, `npm i -g @pinagent/cli`) if you'd rather type `pinagent` directly.

## Subcommands

### `pinagent mcp`

Start the [Model Context Protocol](https://modelcontextprotocol.io) server over stdio. Configure your coding agent (Claude Code, Cursor, etc.) to spawn this process so it can pull pending feedback, screenshots, and source context out of a running Pinagent dev session.

```bash
pinagent mcp
```

Project root resolution (in order):

1. `PINAGENT_PROJECT_ROOT` if set.
2. Walk up from the current directory looking for `.pinagent/`.
3. Fall back to the nearest `package.json` ancestor.
4. Fall back to the current directory.

The MCP server exposes five tools:

| Tool                          | Purpose                                                                                 |
| ----------------------------- | --------------------------------------------------------------------------------------- |
| `list_pending_feedback`       | List items the developer has captured with the widget. Status filter, file filter.      |
| `get_feedback`                | Fetch one item by id, including the screenshot inline as an image content block.        |
| `resolve_feedback`            | Mark fixed / wontfix / deferred (or re-open with `status: 'pending'`). Optional note + commit sha. |
| `get_source_context`          | Read a window of source around a `file:line` pair.                                      |
| `get_conversation_transcript` | Read the full persisted agent transcript for one conversation (text or JSON).           |

Claude Code config example (`~/.claude/mcp_servers.json` or per-project `.mcp.json`):

```json
{
  "mcpServers": {
    "pinagent": {
      "command": "pnpm",
      "args": ["dlx", "@pinagent/cli", "mcp"]
    }
  }
}
```

### `pinagent transcript <id>`

Fetch the persisted agent transcript for one conversation from a
running pinagent dev-server's HTTP endpoint
(`GET /__pinagent/feedback/:id/messages`) and print it. Useful for
exporting a conversation to a markdown file, piping into another
model, or eyeballing what an agent actually did.

```bash
pinagent transcript cv_8a2f
pinagent transcript --server http://localhost:5173 cv_8a2f
pinagent transcript --json cv_8a2f | jq '.[] | select(.type == "tool_use")'
```

Options:

| Flag             | Default                                       | Effect                                                 |
| ---------------- | --------------------------------------------- | ------------------------------------------------------ |
| `--server <url>` | `PINAGENT_SERVER_URL` or `http://localhost:3000` | Base URL of the running dev-server.                    |
| `--json`         | off                                           | Emit raw `AgentEvent[]` JSON instead of formatted text. |

Exit codes:

| Code | Meaning                                                     |
| ---- | ----------------------------------------------------------- |
| `0`  | Success — transcript (possibly empty) written to stdout.    |
| `1`  | Network or unexpected error.                                |
| `2`  | Bad usage (invalid id, missing arg, server returned `400`). |
| `3`  | Conversation not found (server returned `404`).             |

## Environment

| Variable                 | Effect                                                                |
| ------------------------ | --------------------------------------------------------------------- |
| `PINAGENT_PROJECT_ROOT`  | Override the project root the MCP server reads from.                  |
| `PINAGENT_SERVER_URL`    | Default dev-server URL for `pinagent transcript`.                     |

## Build

```bash
pnpm --filter @pinagent/cli build
```

Produces `dist/index.js` (ESM) via `tsdown`. The `bin` field in `package.json` points the published `pinagent` executable at that file.
