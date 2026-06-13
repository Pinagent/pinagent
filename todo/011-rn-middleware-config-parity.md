# 011 — RN: middleware config parity (`apiKey` option + documented env contract)

- **Priority:** P3
- **Packages:** `@pinagent/react-native` (`packages/react-native`)
- **Zone:** Apache-2.0
- **Changeset:** not required (package is changeset-ignored)
- **Read `/todo/README.md` ground rules first**

## Context

`pinagentMiddleware` accepts only `projectRoot` and `spawnMode`
(`packages/react-native/src/server/metro-middleware.ts:43-52` —
`PinagentMiddlewareOpts`). The vite/next plugins additionally accept `apiKey`
(`packages/vite-plugin/src/index.ts:60`), the explicit opt-in agent key that becomes
`PINAGENT_AGENT_API_KEY` for spawned runs. An RN user wanting a pinned key today must know
to export the env var before starting Metro — undocumented, and asymmetric with web.

**Contract guard (do not violate):** pinagent never reads `ANTHROPIC_API_KEY` /
`OPENAI_API_KEY` implicitly. The explicit option (and the dock's Connections store on web)
are the only key inputs; absent both, the agent falls back to subscription auth. The
authority is `agent-auth` in `@pinagent/agent-runner` (PR #408 history) — mirror exactly
what `vite-plugin` does with its `apiKey` option, nothing more.

## Expected behavior

```ts
pinagentMiddleware({ projectRoot: __dirname, spawnMode: 'inline', apiKey: process.env.MY_KEY })
```

behaves like the same option on the vite plugin. The README documents the full config
surface: middleware opts, the `PINAGENT_AGENT_API_KEY` env alternative, and `<Pinagent />`
props (`projectRoot`, `screenName` — `packages/react-native/src/native/Pinagent.tsx:51-61`).

## Implementation notes

1. Add `apiKey?: string` to `PinagentMiddlewareOpts` with JSDoc copied/adapted from
   `vite-plugin/src/index.ts:53-60` (IDE-surface docs matter).
2. Plumb it the same way vite-plugin does — find vite-plugin's handling of the option (it
   bridges to `PINAGENT_AGENT_API_KEY` for the agent-runner spawn) and replicate; don't
   invent a second mechanism. Precedence note from the contract: a key saved at runtime via
   the dock takes precedence on web — RN has no dock, so the option/env is the whole story.
3. README (`packages/react-native/README.md`): a "Configuration" section with a table —
   middleware opts vs component props vs env vars — and one explicit sentence that no
   provider env vars are ever read implicitly.

## Acceptance criteria

- [ ] `apiKey` passed to `pinagentMiddleware` reaches the spawned agent's auth exactly as
      vite-plugin's option does (same env bridge, same precedence).
- [ ] Omitting it preserves today's behavior (env var if the user set one, else
      subscription fallback).
- [ ] Metro middleware test (`packages/react-native/tests/metro-middleware.test.ts`) covers
      the bridge (spy/inspect the spawn path — the middleware itself is Node code and IS
      unit-testable, unlike the native side).
- [ ] README config section added.

## Out of scope

- `worktreeServeCommand` (dock-only; RN has no dock), hotkey config (no global keyboard on
  RN), `window.__pinagentConfig`-style runtime injection (no `window`).
