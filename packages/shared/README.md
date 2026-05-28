# @pinagent/shared

Wire types, zod schemas, and runtime-free constants used across Pinagent packages. The contract layer between the server (`@pinagent/agent-runner`), the dock (`@pinagent/widget-dock`), and the widget (`@pinagent/widget`).

Keep this package thin: no I/O, no Node-only or browser-only dependencies, no React. Anything heavier belongs in a leaf package.

## What lives here

| Module                | Role                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------- |
| `ws-protocol.ts`      | `ClientMessage` / `ServerMessage` schemas — the WebSocket wire contract used by widget ↔ server ↔ dock.       |
| `dock-api.ts`         | REST-shaped schemas for `/__pinagent/*` endpoints (conversations, history, audit, PR composer, settings).     |
| `dock-postmessage.ts` | `postMessage` envelopes for host ↔ embedded-dock-iframe coordination (layout broadcasts, future navigation).  |
| `event-bus.ts`        | Shared `AgentEvent` / `ProjectEvent` shapes. The runtime bus has moved to `@pinagent/agent-runner/bus.ts`; this file remains the *type* surface so producers and consumers agree on the event shape. |

Every schema exports both the inferred type and the zod schema (e.g. `Conversation` + `ConversationSchema`) so producers can `parse` and consumers can rely on the static shape without re-validating.

## Build

```bash
pnpm --filter @pinagent/shared build
```

Dual ESM + CJS under `dist/` via `tsdown`. Zero runtime dependencies beyond `zod`.
