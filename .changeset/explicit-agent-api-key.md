---
"@pinagent/vite-plugin": minor
"@pinagent/next-plugin": minor
---

Add an explicit, opt-in `apiKey` plugin option and stop reading the agent API
key from the environment implicitly.

Pinagent previously inherited whatever `ANTHROPIC_API_KEY` (and, via the
bring-your-own CLI provider, `OPENAI_API_KEY`) sat in the dev server's shell.
The Claude Agent SDK authenticates from the first credential it finds, so a
stale, scoped, or third-party key exported for some other tool got billed — and,
when invalid, shadowed the user's Claude Code / Codex subscription so runs died
with `authentication_failed` ("Invalid API key").

A key is now used only when the consuming app hands one to pinagent on purpose:
`pinagent({ apiKey })` (Vite) / `pinagent(config, { apiKey })` (Next), bridged to
the runner as `PINAGENT_AGENT_API_KEY`, or a key saved at runtime via the dock's
Connections route. With neither set, the implicit key is stripped and the run
falls back to the agentic subscription. The dock key takes precedence over the
plugin option.

Behaviour change for the CLI provider: a wrapped CLI (Codex, aider, …) no longer
inherits an ambient `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`. Codex now falls back
to its ChatGPT login by default; pass `apiKey` to supply a raw key explicitly.
