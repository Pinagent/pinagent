<!-- SPDX-License-Identifier: Apache-2.0 -->
# Multi-context state — what doesn't work, what does

This is a survival guide for anyone about to add shared state between
the WS server, the route handler, and the spawned agent inside one of
our framework adapters. The same bug class has bitten this codebase
four times in different shapes — PRs #52, #55, #56, and the example
bump in #57. If you're tempted to reach for `globalThis`, stop and
read this first.

## Why we have multiple contexts in one process

Next 16 (Turbopack) and Vite 8 both load plugin code into **multiple
V8 contexts within a single Node process**:

- **Next 16 / Turbopack:** route modules can be evaluated more than
  once. HMR, workers, and certain route-handler boundaries each get
  their own context. Symptom: the dev-server log shows
  `[pinagent] WebSocket server already running on port 53636 (duplicate
  bind ignored)` — two `startWsServer()` calls both tried to bind.
- **Vite 8 environments:** the new
  [environment API](https://vite.dev/guide/api-environment.html)
  introduces SSR / RSC / worker environments that each have their
  own globals. Same symptom from the same code path.

Each context has its own `globalThis`. They share **everything else**
the Node process exposes — the file system, the `process` object, open
TCP ports, the SQLite database file.

## The trap: `globalThis` singletons

The naive pattern for "one instance per dev-server process" looks like:

```ts
const SYMBOL = Symbol.for('pinagent.thing');
const thing = (globalThis as Record<symbol, Thing>)[SYMBOL] ?? new Thing();
(globalThis as Record<symbol, unknown>)[SYMBOL] = thing;
```

This **only works for module re-evaluations inside one context**. Two
contexts each have their own `globalThis` slot, so each gets a fresh
`Thing`. State written into context A is invisible to context B even
though both run in the same Node process.

We hit this with:

| What | Was | Bug |
| --- | --- | --- |
| Event bus (`Map<id, Bus>`) | `globalThis.Symbol` | Agent publishes in B, widget subscribes in A → silent zero events ([#52](https://github.com/Pinagent/pinagent/pull/52)) |
| Active runs (`Map<id, AbortController>`) | `globalThis.Symbol` | Stop button silently no-ops across contexts ([#56](https://github.com/Pinagent/pinagent/pull/56)) |
| Pending asks (`Map<askId, resolve>`) | `globalThis.Symbol` | `ask_user` answers silently swallowed across contexts ([#56](https://github.com/Pinagent/pinagent/pull/56)) |

## The three patterns that do work

Pick by the *shape* of what you're sharing.

### 1. SQLite for persistent or replayable state

Every context can open `.pinagent/db.sqlite`. WAL mode is already on.
This is the right shape when:

- The state is **data** (events, run metadata, conversation rows).
- You want it to **survive a dev-server restart** (free side effect).
- A polling latency of ~100ms is acceptable.

**Example:** the event bus.
[`packages/agent-runner/src/bus.ts`](../../packages/agent-runner/src/bus.ts) —
`publish` is an `INSERT`, `subscribe` polls for rows with `id >
lastSeenId` every 100ms. Schema in
[`packages/db/src/schema.ts`](../../packages/db/src/schema.ts).

**Example:** `hasActiveRun(id)` consults the `active_runs` table after
checking the local-context Map.
[`packages/agent-runner/src/agent.ts`](../../packages/agent-runner/src/agent.ts).

### 2. `process` events for transient signals

`process` is a Node-global, not a context-local. **Every context in one
process shares the same `process` EventEmitter.** Use this when:

- The state is a **process-bound object** that can't be serialised —
  `AbortController`, Promise `resolve`/`reject` closures, open sockets.
- You only need fire-and-forget delivery; if no listener exists, you
  don't care.
- You don't need cross-process delivery (this is in-process only).

**Pattern:**

```ts
// In the context that owns the resource:
const onSignal = (payload: Payload) => { /* react if it's for me */ };
process.on('pinagent:event', onSignal);
// ... in finally:
process.off('pinagent:event', onSignal);

// In any other context:
process.emit('pinagent:event' as never, payload as never);
```

**Examples:** interrupt + `ask_user` response.
[`packages/agent-runner/src/agent.ts`](../../packages/agent-runner/src/agent.ts)
(`INTERRUPT_EVENT`) and
[`packages/agent-runner/src/ask-user.ts`](../../packages/agent-runner/src/ask-user.ts)
(`ASK_RESPONSE_EVENT`).

**Caveat:** the return value of the function that emits has to be
optimistic — you can't synchronously know if another context handled
it. Pair with SQLite if you need the "did anyone have this?" check
(see `interruptRun` for the pattern).

### 3. Port auto-fallback for cross-process coordination

The WS server is bound to a single TCP port. Two pinagent dev servers
running on the same machine (or one project plus a stale dev server
from another) collide.

**Pattern:** probe forward from the requested port. Mutate
`process.env.PINAGENT_WS_PORT` to the actually-bound port so anyone
reading the env (e.g. the widget-bundle prelude in
[`next-plugin/route.ts`](../../packages/next-plugin/src/route.ts))
reports the right URL.

[`packages/agent-runner/src/ws-server.ts`](../../packages/agent-runner/src/ws-server.ts)
— see `tryBind` and the `PORT_FALLBACK_RANGE` loop in
`startWsServer`.

## Checklist for a new piece of shared state

Before adding `const X = Symbol.for('pinagent.x')`, ask:

- [ ] Does this need to be visible across contexts in one Node
      process? If no, a plain module-scoped variable is fine.
- [ ] Is the value **data** (string/number/json)? → SQLite.
- [ ] Is the value a **process-bound object** (AbortController,
      socket, Promise closure)? → `process` events for signalling,
      SQLite for state queries.
- [ ] Does it need to survive a dev-server restart? → SQLite.
- [ ] Do I need a cross-*process* answer (not just cross-context)? →
      SQLite, possibly with `Atomics.notify` or a polling channel.
      Don't try this without a real reason; we've never needed it yet.

`globalThis.Symbol` singletons are still fine for **caches local to
one context** (e.g. the per-context bus instance cache in
[`bus.ts`](../../packages/agent-runner/src/bus.ts), which short-circuits
allocation in the same context but isn't relied on for cross-context
consistency).

## How to reproduce the bug class locally

Even with all the fixes in place, regressions happen. Quickest local
reproduction:

```bash
# 1. Start a stub blocker on the default WS port to force a fallback.
node -e "require('net').createServer().listen(53636, () => console.log('blocking 53636'))" &

# 2. Wipe state and boot the example.
rm -rf examples/next-app/.pinagent
pnpm --filter next-app-example dev

# 3. The log will show "port 53636 in use ... trying 53637", and
#    typically a second "duplicate bind" / "trying 53638" line —
#    proof that two contexts attempted to bind. Submit feedback,
#    hit Stop mid-run, answer an ask_user prompt. Any silent failure
#    in those flows means the cross-context plumbing regressed.
```

The Vite-8 example (`examples/react-vite`) reproduces the same context
isolation through the environment API. The dock app
(`packages/widget-dock`) is on Vite 8 too.

## Further reading

- [`packages/agent-runner/src/bus.ts`](../../packages/agent-runner/src/bus.ts)
  — the canonical SQLite-backed pattern.
- [`packages/agent-runner/src/agent.ts`](../../packages/agent-runner/src/agent.ts)
  — `runQuery` shows the local-Map + SQLite-state + process-event
  triple in one place.
- PRs #52, #55, #56 — the original incidents, with rationale in the
  commit messages.
