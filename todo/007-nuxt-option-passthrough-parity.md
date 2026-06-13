# 007 — nuxt-plugin: option passthrough parity (`apiKey`, `worktreeServeCommand`)

- **Priority:** P2
- **Packages:** `@pinagent/nuxt-plugin` (`packages/nuxt-plugin`)
- **Zone:** Apache-2.0
- **Changeset:** **required** — minor bump for `@pinagent/nuxt-plugin` (new public options)
- **Read `/todo/README.md` ground rules first**

## Context

The Nuxt module wraps the entire vite-plugin (`packages/nuxt-plugin/src/module.ts` —
`addVitePlugin(pinagent({...}))` around line 68), but its `ModuleOptions` only exposes
`spawnAgent` and `dock` (`module.ts:28-45`). Two vite-plugin options can't be set from Nuxt:

- `apiKey` (`packages/vite-plugin/src/index.ts:60`) — the explicit, opt-in agent key
  (→ `PINAGENT_AGENT_API_KEY`). **Contract guard:** pinagent never reads
  `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` implicitly; the explicit option and the dock
  Connections route are the only inputs (see `agent-auth` in agent-runner, PR #408
  history). The passthrough must not invent any env-var fallback.
- `worktreeServeCommand` (`packages/vite-plugin/src/index.ts:77-93`) — custom dev-server
  command for the dock's worktree "Open app" action. Nuxt apps are exactly the case that
  needs it (`nuxt dev` vs the default).

So a Nuxt user with `dock: true` gets worktree serving that may launch the wrong command,
and has no plugin-level way to pin an agent key.

## Expected behavior

`pinagent: { spawnAgent, dock, apiKey, worktreeServeCommand }` in `nuxt.config.ts` behaves
identically to the same options on `pinagent()` in a Vite app. Future drift gets caught by a
test.

## Implementation notes

1. Add both options to `ModuleOptions` (`module.ts:28-45`) — copy the option JSDoc from
   `vite-plugin/src/index.ts` and adapt (these doc comments surface in consumers' IDEs).
   Type them via `PinagentOptions['apiKey']` etc., as `spawnAgent` already does.
2. Forward them in the `pinagent({...})` call using the existing
   `...(options.x !== undefined ? { x: options.x } : {})` spread pattern (`module.ts:68-72`).
3. Add/extend the module glue test (`packages/nuxt-plugin/tests/`) asserting the options
   arrive on the inner vite plugin call. Consider a drift guard: assert
   `keyof ModuleOptions ⊆ keyof PinagentOptions` (type-level `satisfies` or a runtime key
   list) so the next vite-plugin option added forces a conscious decision here.
4. Update `packages/nuxt-plugin/README.md` with the full forwarded-options table, including
   a sentence on what is deliberately NOT forwarded (`root` is derived from
   `nuxt.options.rootDir`, `module.ts:69`).

## Acceptance criteria

- [ ] `apiKey` set in `nuxt.config.ts` reaches the spawned agent (manifests as
      `PINAGENT_AGENT_API_KEY` for the run; verify via the option's documented behavior, not
      by adding new env plumbing).
- [ ] `worktreeServeCommand` set in Nuxt is used by the dock worktree serve flow.
- [ ] Glue test covers both forwards; README documents all four options.
- [ ] Changeset (minor) present; `pnpm build && pnpm typecheck && pnpm test && pnpm lint` green.

## Out of scope

- Forwarding `root` (correctly derived), or inventing nuxt-only options.
- Any implicit env-var key fallback (contract violation — see above).
