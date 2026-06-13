---
'@pinagent/nuxt-plugin': minor
---

Forward the `apiKey` and `worktreeServeCommand` options from `nuxt.config.ts`'s
`pinagent: {…}` to the underlying `@pinagent/vite-plugin`, reaching full option
parity with the Vite and Next.js integrations.

- `apiKey` — explicit, opt-in agent key (bridged to the runner as
  `PINAGENT_AGENT_API_KEY`). Unset still means subscription auth; Pinagent never
  reads `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` implicitly.
- `worktreeServeCommand` — custom dev-server command for the dock's worktree
  "Open app" action (e.g. `nuxt dev --port {port}`).

`root` remains deliberately derived from `nuxt.options.rootDir` and is not a
forwarded option.
