# @pinagent/mcp

## 0.0.2

### Patch Changes

- 6520e38: Export `startMcpServer` so `@pinagent/cli`'s new `pinagent mcp` subcommand
  can drive the server in-process. The package's bin entry still auto-starts
  when invoked directly (`pinagent-mcp`), gated by an `import.meta.url` check
  that skips the auto-start when the module is imported as a library.
