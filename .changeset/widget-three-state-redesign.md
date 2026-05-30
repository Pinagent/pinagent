---
"@pinagent/next-plugin": minor
"@pinagent/vite-plugin": minor
---

feat(widget): redesign the spawned-agent widget into three explicit states

The per-element agent widget now has three deliberate presentation states,
driven by a new `viewState` (`minimal` | `expanded` | `bubble`), orthogonal
to the agent lifecycle:

- **Minimal** — the default after spawn, redesigned from the multi-line mini
  card into a single line: a status indicator (running spinner, an animated
  green check on completion, an alert when the agent needs input, or an error
  ✗) plus state-driven action icons — stop (interrupt), cancel (interrupt +
  dismiss), and an answer affordance that appears when the agent asks a
  question. On successful completion while collapsed it animates the check
  and auto-closes after ~5s (cancelled the moment you expand or interact).
- **Expanded** — the full conversation now lets you **queue follow-up
  messages while a turn is in flight** (held client-side and flushed FIFO at
  each turn-end, since the server rejects a mid-turn message) and **add other
  elements to a running conversation** via a new picker affordance — each
  picked element joins as a queued follow-up with its `file:line` location.
- **Bubble** — a floating status dot with the same stop/cancel affordances,
  entered manually (collapse-to-dot) or automatically when the anchored
  element scrolls off-screen.

Widget-only change (no WS protocol change); added elements carry their text
location, not a screenshot.
