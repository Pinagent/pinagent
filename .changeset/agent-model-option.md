---
'@pinagent/vite-plugin': minor
'@pinagent/next-plugin': minor
'@pinagent/react-native': minor
'@pinagent/widget-dock': minor
---

Choose the Claude model for inline agent runs, and require Claude Agent SDK `^0.3.294`.

Spawned agents never passed `model` to the Claude Agent SDK, so they ran on
whatever default the SDK's bundled Claude Code CLI shipped with — which tracks
the SDK version your lockfile resolved, not the Claude Code you have installed
(e.g. SDK 0.3.183 ran `claude-opus-4-8[1m]` while `claude` 2.1.294 used Opus
5.5). The model is now configurable:

- `PINAGENT_AGENT_MODEL` — env override (an alias like `opus` / `sonnet`, or a
  full id like `claude-opus-5-5`), passed through as the SDK's `model`.
- `"model"` in `.pinagent/config.json` — the per-project setting, editable in
  the dock's Settings → Agent model. The env var wins when both are set, and
  the dock shows a banner when it does (mirroring `PINAGENT_AGENT_PERMISSION_MODE`).
- Neither set: `model` is omitted and the SDK default applies, as before.

This is separate from the BYO CLI provider's `PINAGENT_AGENT_CLI_MODEL`, which
only labels the widget's model chip.

The `@anthropic-ai/claude-agent-sdk` floor moves from `^0.3.181` to `^0.3.294`
(bundled Claude Code 2.1.294), so the SDK default is current too.
