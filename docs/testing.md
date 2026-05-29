# Testing guide

Pinagent is a pnpm monorepo with one Vitest project at the root. This document
explains how tests are organized, what flows are covered today, and — if you're
new to the codebase — which areas to verify first.

## TL;DR

```bash
pnpm install            # once (Node 22+, pnpm 10+); builds the widget test suite's better-sqlite3 automatically
pnpm build              # turbo builds every package's dist (some tests import from src, others from built deps)
pnpm test               # vitest run, picks up packages/*/tests/**/*.test.ts
pnpm test:watch         # interactive watch mode
pnpm typecheck          # turbo typecheck across the workspace
pnpm lint               # biome check
```

Run a single package's tests:

```bash
pnpm vitest run packages/agent-runner/tests
pnpm vitest run packages/widget/tests/selector.test.ts
```

## Test layout

- One Vitest config at the repo root: `vitest.config.ts`. It globs
  `packages/*/tests/**/*.test.ts`. There is no per-package vitest config.
- Default environment is Node. DOM-needing tests opt in with a file-top
  pragma: `// @vitest-environment happy-dom`.
- `better-sqlite3` and `@sqlite.org/*` are externalized in `server.deps.external`
  so Vite's resolver doesn't try to transform native code.
- Tests live next to the package they cover at `packages/<pkg>/tests/`. No
  global fixtures directory — each test allocates its own tmp dir under
  `os.tmpdir()` and cleans up.

## Layers of test

The repo has three distinct layers, each with a different testing style.

### 1. Pure unit tests

Single-file, no I/O. Examples:

- `packages/babel-plugin/tests/transform.test.ts` — JSX → `data-pa-loc` rewrite.
- `packages/widget/tests/selector.test.ts` — CSS-selector serialization (happy-dom).
- `packages/widget-dock/tests/useKeyboardShortcuts.test.ts` — pure matcher
  function behind the React hook.
- `packages/shared/tests/ws-protocol.test.ts`, `dock-postmessage.test.ts` —
  zod schema parse/serialize round-trips.

These are the cheapest to write and the first place to add coverage when
touching a pure function or schema.

### 2. Module-level integration with real I/O

Tests spin up real SQLite databases in tmp dirs, real WebSocket servers on
test-local ports, real fs reads/writes — but the Claude Agent SDK is stubbed.
Examples:

- `packages/agent-runner/tests/agent-spawn.test.ts` — scripts the SDK's
  `query()` async iterable, verifies the spawn → follow-up → interrupt loop
  drives the event bus, log writer, and Storage as expected.
- `packages/agent-runner/tests/ws-server.test.ts` — boots the real
  `WebSocketServer` on `127.0.0.1:53700`, connects a real `ws` client, asserts
  on `ServerMessage` frames.
- `packages/agent-runner/tests/storage.test.ts`, `audit-log.test.ts`,
  `merge-queue.test.ts`, `ws-worktree.test.ts` — Drizzle migrations and
  storage layer against fresh sqlite files.
- `packages/next-plugin/tests/route.test.ts` — imports the route handlers
  directly and feeds them web-standard `Request` objects; no Next dev server.
- `packages/widget/tests/db.test.ts`, `migrations.test.ts` — SQLite migrations
  via the wasm build.

Patterns to copy for new tests in this layer:

```ts
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nanoid } from 'nanoid';

const PROJECT_ROOT = join(tmpdir(), `pa-thing-${nanoid(8)}`);

beforeAll(async () => {
  process.env.PINAGENT_PROJECT_ROOT = PROJECT_ROOT;
  process.env.PINAGENT_SPAWN_AGENT = 'off'; // skip WS bind when not needed
  await mkdir(PROJECT_ROOT, { recursive: true });
});

afterAll(async () => {
  await rm(PROJECT_ROOT, { recursive: true, force: true });
  delete process.env.PINAGENT_PROJECT_ROOT;
});
```

- Always allocate per-file tmp dirs (`nanoid`) so vitest's parallel workers
  don't collide on SQLite files or worktree paths.
- Set `PINAGENT_SPAWN_AGENT='off'` if the code under test would otherwise
  start a real agent or WebSocket server.
- For WS tests, pick a port well clear of the production default (`53636`).
  `53700+` is the convention in the existing tests.
- Import the module under test *after* env vars are set so its top-level
  initialization sees the test config.

### 3. Manual end-to-end via the example apps

There is currently no Playwright / browser-driver suite. Cross-package
behavior (JSX tagging → widget pick → middleware POST → agent SDK → resolve)
is verified by running the bundled examples.

```bash
pnpm install
pnpm build
pnpm --filter react-vite-example dev   # http://localhost:5173
pnpm --filter next-app-example dev     # http://localhost:3000
```

The five-step smoke flow from the README:

1. Open the dev URL.
2. Click the Pinagent logo (bottom-right). The picker activates.
3. Click an element, type a comment, submit.
4. The widget pane opens next to the element and streams agent output.
5. Verify the file on disk was modified, and the conversation row in
   `<example>/.pinagent/db.sqlite` has status `fixed`.

This is the closest thing the repo has to an integration test for the full
loop. Run it before opening any PR that touches the widget, the plugins, the
route handler, or the agent runner.

## First testing flows — by priority

If you're new to the repo and want to know what's worth verifying first, work
the list top-down. Each item names the smallest test that breaks if the
behavior regresses, and the manual smoke that proves it cross-package.

### Flow 1 — JSX tagging produces the right `data-pa-loc`

The whole loop depends on this attribute. If it's wrong, every comment is
anchored to the wrong file:line.

- Unit: `packages/babel-plugin/tests/transform.test.ts`
- Manual: `pnpm --filter react-vite-example dev`, open the page, inspect any
  element in DevTools — every JSX node should have
  `data-pa-loc="src/<file>.tsx:<line>:<col>"`.

### Flow 2 — Widget selects the right element and emits the right anchor

- Unit: `packages/widget/tests/selector.test.ts` (`shortSelector`, `findLoc`,
  `findReanchorTarget`).
- Manual: with the example running, click the logo, hover, click a deeply
  nested element — the composer header should show the right file:line.

### Flow 3 — `/__pinagent/feedback` POST persists and emits events

- Unit (Next.js): `packages/next-plugin/tests/route.test.ts`. Asserts the GET,
  POST, PATCH handlers store/read the right rows.
- Unit (storage): `packages/agent-runner/tests/storage.test.ts`. Drizzle
  migrations and CRUD on conversations + messages.
- Manual: submit a comment in either example. Inspect
  `<example>/.pinagent/db.sqlite` (it's a SQLite file; open with any
  client) — a new row in the `conversations` table plus an event row in
  `messages`. Screenshots are still PNGs on disk at
  `<example>/.pinagent/screenshots/<id>.png`. The WS pane should also
  receive `feedback.created` and a sequence of agent events.

### Flow 4 — Agent spawn, follow-up, and interrupt drive the event bus

The most fragile path because it stubs the Anthropic SDK and threads the
fake message stream through real Drizzle + filesystem code.

- Integration: `packages/agent-runner/tests/agent-spawn.test.ts`. Verifies
  SDK messages → AgentEvents, markdown log emission, session_id persisted
  for follow-ups, abort wiring.
- Integration: `packages/agent-runner/tests/ws-server.test.ts`. Real
  WebSocket frames over `127.0.0.1:53700`.
- Manual: submit a comment in either example, watch the widget pane
  stream tool calls and text, then the diff. Submit a *second* comment
  on the same element — verify the follow-up resumes the same session
  (no fresh "Starting up…" header).

### Flow 5 — Dock schemas accept future-extended payloads (`.passthrough()`)

`packages/shared/src/dock-api.ts` uses `.passthrough()` everywhere so the
agent-runner can add fields without breaking old dock builds.

- Unit: `packages/shared/tests/ws-protocol.test.ts`,
  `dock-postmessage.test.ts`. Round-trip parse/serialize for every schema.
- When adding a new field to a schema, add a test that parses a payload
  *with* the field and one *without* it — both should succeed.

### Flow 6 — Worktree mode keeps comments isolated

- Integration: `packages/agent-runner/tests/ws-worktree.test.ts`,
  `agent-merge.test.ts`, `merge-queue.test.ts`.
- Manual: set `spawnAgent: 'worktree'` in either example's plugin config,
  submit two comments on different elements. Each should get its own
  `.pinagent/worktrees/<id>` and branch `pinagent/<id>`. Editing both
  files in the host repo should not affect either worktree's state.

### Flow 7 — Keyboard shortcuts in the dock

- Unit: `packages/widget-dock/tests/useKeyboardShortcuts.test.ts` (pure
  matcher).
- Manual: opt the example into the dock surface (`dock: true` in the
  plugin config — already on in `examples/next-app`), then click the
  bottom-left ink pin to open it. Try the documented shortcuts
  (`Cmd/Ctrl+Shift+P` to toggle, `g` chord for navigation, `/` to focus
  search; see [`packages/widget-dock/README.md`](../packages/widget-dock/README.md)).

## Adding a new test

1. Pick the layer (pure / integration / manual). When in doubt, start with a
   pure unit test.
2. Drop the file at `packages/<pkg>/tests/<feature>.test.ts`. It will be
   picked up automatically.
3. If you need a DOM, add `// @vitest-environment happy-dom` as the first
   non-license line.
4. If you need filesystem or sqlite, use the `tmpdir + nanoid` pattern
   above and clean up in `afterAll`. Do not write into the repo tree.
5. If you need to fake the Claude Agent SDK, mirror the `vi.mock` pattern
   from `agent-spawn.test.ts` — keep the import of the module under test
   *after* the mock is declared.
6. If your test boots a WS server, pick a port outside the `53636` family
   (the dev-server default) — use the test-local `53700` range so a stale
   dev server doesn't silently win the bind.

## Gotchas

- **`better-sqlite3` is test-only.** The runtime stores data via Node's
  built-in `node:sqlite` (no native build) — `better-sqlite3` is used only by
  the `@pinagent/widget` DB test helpers. It's listed in `pnpm-workspace.yaml`'s
  `onlyBuiltDependencies`, so a plain `pnpm install` compiles its binding; no
  `pnpm approve-builds` step is needed. If the binding is somehow missing, only
  the widget DB tests fail with `Could not locate the bindings file`.
- **Port 53636 collisions.** The widget connects to this port for the
  agent-runner WS. A stale dev server from another Pinagent project can
  silently steal the connection. Kill orphans before debugging WS tests.
- **Examples need built plugin dist.** `examples/react-vite` has a `predev`
  hook that builds `@pinagent/vite-plugin`. If you edit a plugin source
  file and rerun the example without a build, you'll be running the old
  bundle. `pnpm build` from the repo root forces a fresh rebuild.
- **Biome and `.claude/worktrees/`.** `pnpm lint` exits 1 with "No files
  processed" inside a `.claude` worktree because the config excludes that
  path. Run biome with an explicit target path from a worktree:
  `pnpm exec biome check packages/ apps/ scripts/`.
- **Test isolation.** `isolate: true` is on in `vitest.config.ts` — each
  test file gets its own worker. Don't rely on module-level state set by
  one test being visible to another.

## What's missing today

These are gaps, not bugs — useful to know if you're considering where to
invest test work:

- No Playwright / browser-driven coverage of the click → comment →
  resolve loop. The manual smoke in Flow 4 is the only verification.
- No automated test of the MCP server (`packages/mcp`). The bin is
  exercised manually by registering it with Claude Code.
- No test for the babel/Turbopack loader hookup specifically — only the
  underlying transform. Plugin wiring is covered manually via the
  examples.
- `apps/cloud/` and `ee/` have minimal coverage today; what's there lives
  alongside the source.

If you add coverage in any of these areas, keep the same `packages/*/tests/`
convention so the root Vitest config picks it up without extra wiring.
