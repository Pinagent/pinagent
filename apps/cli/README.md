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

The MCP server exposes four tools:

| Tool                     | Purpose                                                                                 |
| ------------------------ | --------------------------------------------------------------------------------------- |
| `list_pending_feedback`  | List items the developer has captured with the widget. Status filter, file filter.      |
| `get_feedback`           | Fetch one item by id, including the screenshot inline as an image content block.        |
| `resolve_feedback`       | Mark fixed / wontfix / deferred (or re-open with `status: 'pending'`). Optional note + commit sha. |
| `get_source_context`     | Read a window of source around a `file:line` pair.                                      |

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

## Environment

| Variable                 | Effect                                                                |
| ------------------------ | --------------------------------------------------------------------- |
| `PINAGENT_PROJECT_ROOT`  | Override the project root the MCP server reads from.                  |

## Build

```bash
pnpm --filter @pinagent/cli build
```

Produces `dist/index.js` (ESM) via `tsdown`. The `bin` field in `package.json` points the published `pinagent` executable at that file.
