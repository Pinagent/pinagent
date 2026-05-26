---
'@pinagent/next-plugin': patch
'@pinagent/vite-plugin': patch
---

Refactor: extract shared modules (`event-bus`, `ws-protocol`) into
`@pinagent/shared`, the JSX transform + webpack loader into
`@pinagent/babel-plugin`, and the Agent SDK runtime (agent, ws-server,
storage, worktree management, `ask_user`, db client) into
`@pinagent/agent-runner`. `@pinagent/next-plugin` is now a thin Next adapter
over `@pinagent/agent-runner`; `@pinagent/vite-plugin` shares the same
storage layer and JSX transform. No externally observable API changes —
`@pinagent/next-plugin/loader` and `@pinagent/next-plugin/route` still
work as before.
