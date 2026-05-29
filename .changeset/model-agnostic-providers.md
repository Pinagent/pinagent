---
'@pinagent/next-plugin': minor
'@pinagent/vite-plugin': minor
---

Spawn-mode agents now run behind a model-agnostic provider abstraction.
The Claude Agent SDK remains the default; set `PINAGENT_AGENT_PROVIDER=cli`
to bring your own agentic CLI (Codex, aider, opencode, Cline, a wrapper
script) via `PINAGENT_AGENT_CLI_COMMAND`. See
`docs/architecture/agent-providers.md`.
