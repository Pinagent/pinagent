<!-- SPDX-License-Identifier: Elastic-2.0 -->
# @pinagent/ee-relay

Hosted multi-tenant relay between developer machines and cloud clients.
Source-available under the [Elastic License v2](./LICENSE) — not open source.

## Why it exists

Locally, the browser widget talks straight to the dev machine's
`agent-runner` over `ws://127.0.0.1:53636`. To reach that machine from a
hosted dock (behind NAT, no inbound port), the **agent-runner dials *out***
to this relay, and clients connect *in*. The relay pins the two sides
together and shuttles the existing wire protocol between them.

```
browser / hosted dock ──in──►  CF Worker (router)
                                     │  idFromName(session)
                                     ▼
                            Durable Object: RelaySession
                                     ▲
agent-runner ──────out (dial)────────┘   one device socket per session
```

## Architecture

| File | Role |
|---|---|
| `src/relay-hub.ts` | **`RelayHub`** — runtime-agnostic routing core. Reference-counts `subscribe`/`unsubscribe` across clients, demultiplexes `feedbackId`-tagged server frames back to the right clients, validates every frame against `@pinagent/shared` schemas. Fully unit-tested in Node. |
| `src/relay-do.ts` | **`RelaySession`** Durable Object. Wraps `workerd` WebSockets around a `RelayHub` using the Hibernation API; rebuilds hub state from socket attachments after a wake. |
| `src/worker.ts` | Edge router. Auth seam (`verifyToken`, a stub for `ee-auth`), session→DO routing. |

The relay is a **transparent pass-through** — it routes frames but never
reinterprets their contents, so the widget and `agent-runner` are unchanged.

## What's stubbed (next steps)

- **Auth** — `verifyToken` accepts any non-empty token. `@pinagent/ee-auth`
  replaces it with signed-token verification and real tenant derivation.
- **Metering / audit** — `@pinagent/ee-billing` and `@pinagent/ee-team-features`
  hook the connection lifecycle, not the message stream.
- **Dev-side dial-out** — `agent-runner` needs an outbound relay client
  (currently it only binds a local `ws` server).

## Commands

```sh
pnpm --filter @pinagent/ee-relay test         # RelayHub unit tests (Node)
pnpm --filter @pinagent/ee-relay typecheck    # tsc against workers-types
pnpm --filter @pinagent/ee-relay dev:worker   # wrangler dev (local workerd)
pnpm --filter @pinagent/ee-relay deploy       # wrangler deploy
```
