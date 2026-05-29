# @pinagent/vite-plugin

## 0.3.0

### Minor Changes

- 41867df: Spawn-mode agents now run behind a model-agnostic provider abstraction.
  The Claude Agent SDK remains the default; set `PINAGENT_AGENT_PROVIDER=cli`
  to bring your own agentic CLI (Codex, aider, opencode, Cline, a wrapper
  script) via `PINAGENT_AGENT_CLI_COMMAND`. See
  `docs/architecture/agent-providers.md`.
- cf3dc7e: Richer anchor context: enclosing component + loop-instance disambiguation.

  The Babel plugin now stamps a companion `data-pa-comp` attribute next to
  `data-pa-loc`, carrying the nearest **enclosing component** name (the
  closest PascalCase function/class that renders the element). The widget
  reads it on pick, shows `in <PriceCard>` in the composer header, and
  sends three new pieces of context to the agent:

  - **component** — the enclosing component name, e.g. `PriceCard`.
  - **componentPath** — the outer→inner chain of distinct components
    (`App › PriceList › PriceCard`), giving structural context.
  - **loop instance** — when the same JSX literal is rendered more than
    once (a `.map()`), the picked element's `data-pa-loc` is shared across
    many DOM nodes. The widget now records _which_ instance was clicked
    (index + total) plus a content fingerprint (text snippet + identity
    attributes), so the agent can act on the right list item instead of
    the first match. The agent's initial prompt calls this out explicitly.

  All fields are optional on the wire and null in the DB for the common
  single-pick / uninstrumented case, so existing payloads are unchanged.
  Backed by five new nullable `widget_anchors` columns (additive
  migration; the dev server and browser cache both apply it on connect).

### Patch Changes

- e1a3cfc: BYO-model CLI runs show "cost not tracked" instead of a misleading "$0.0000".

  The `cli` provider wraps an external agentic CLI that doesn't report token
  cost, so it records `totalCostUsd: 0` as a placeholder. Rendering that as a
  literal "$0.0000" read as "this run was free" rather than "we can't measure
  this run's cost".

  A new shared `isUntrackedCost(apiKeySource)` helper (true for the `cli`
  provider, mirroring `isNotionalCost` for `oauth`) is now the single source of
  truth, used by the three cost-render surfaces — the in-page widget footer, the
  plain-text transcript (`pinagent transcript` CLI + MCP tool), and the dock's
  transcript result row — to label these runs "cost not tracked". Billed
  (API-key) and notional (subscription) runs are unchanged, and the dock's
  running-cost chip already hid `$0`, so it needs no change.

- f69009c: The Claude provider now emits a clean terminal result on abort and SDK errors.

  `ClaudeCodeProvider` let the Claude Agent SDK's stream throw straight through
  to the orchestrator's generic catch, so clicking **Stop** surfaced as an
  `error` state carrying a raw `AbortError` message, and any SDK failure
  produced no terminal `result` event at all — unlike the CLI provider, which
  emits a `result` with a meaningful subtype.

  The provider now wraps the SDK stream: if it throws before delivering its own
  `result`, the provider synthesizes a terminal `result` — `subtype: 'aborted'`
  when the run was aborted (no error noise), or `subtype: 'error'` with the
  failure detail otherwise. Both providers now guarantee a terminal `result`
  with a consistent subtype, so the widget always leaves the running state and a
  Stop reads as "aborted" rather than an error.

- 1912545: Harden the bring-your-own-model CLI agent provider against edge cases.

  Four robustness fixes to the new `cli` provider (wraps an arbitrary
  agentic CLI and translates its output into Pinagent events):

  - **Signal-terminated runs are no longer reported as success.** A child
    killed by a signal (SIGKILL on OOM, SIGSEGV on a crash) exits with a
    null code; `code ?? 0` previously made that look like a clean exit 0.
    The result now inspects the terminating signal and reports an error.
  - **A child that exits before reading stdin no longer crashes the dev
    server.** Writing the prompt into a closed/again-destroyed stdin pipe
    emitted an unhandled `EPIPE` error; stdin now has an error handler and
    the write is guarded.
  - **Spawn failures surface the real cause.** A missing or non-executable
    command (ENOENT/EACCES) now reports `failed to start <cmd>: <reason>`
    instead of a misleading "exited with code 1".
  - **stderr stays diagnostics.** stderr lines are always rendered as
    tagged text (even in `stream-json` mode, where a non-JSON diagnostic
    would otherwise masquerade as untagged model output) and never inflate
    the turn/progress counter, which tracks assistant turns.

- f9c1f5e: Cost-cap refusal messages no longer claim money was "spent" on a Claude subscription.

  `checkCostCaps` gates each turn on the per-conversation cap and monthly
  budget by summing the SDK's `total_cost_usd`. On a `claude login` (OAuth)
  run that figure is notional — billed against the subscription quota, never
  charged — so the breach message ("$5.00 of $5.00 spent") was misleading.

  The cap still enforces (it's a proxy for how much agent runtime to allow),
  but for subscription runs the message now reads "≈$5.00 of $5.00
  API-equivalent (subscription — not billed)", reusing the same
  `isNotionalCost` relabeling the dock and widget footer already apply.
  API-key runs are unchanged.

- 8865204: The remaining cost renderers now relabel notional subscription cost.

  After the dock, widget footer, and cost-cap messages were made
  subscription-aware, two surfaces still printed the SDK's
  `total_cost_usd` as a bare `$` for `claude login` (OAuth) runs, where the
  figure is notional (billed against the subscription quota, never
  charged):

  - The plain-text transcript renderer (`renderTranscript`) shared by the
    `pinagent transcript` CLI and the MCP `get_conversation_transcript`
    tool — now reads `≈$X API-equivalent (subscription)`. It captures the
    source from the transcript's `init` event.
  - The markdown log footer (`renderResultFooter`) appended to each
    conversation's log — now reads `≈$X API-equivalent (subscription —
not billed)`. `apiKeySource` is threaded from the run's init message
    (and from the stored record on the resolution path).

  Both reuse the shared `isNotionalCost` helper. API-key runs are
  unchanged.

- d44a04a: The dock no longer shows a misleading dollar cost for Claude-subscription runs.

  Agent runs report a `total_cost_usd` from the Claude Agent SDK. On a
  `claude login` (OAuth) subscription that figure is notional — billed
  against the subscription quota, not a card. The in-page widget footer
  already relabeled it as `subscription`, but the dock had no access to the
  run's credential source, so its cost chip rendered the raw `$` regardless
  of auth mode.

  `apiKeySource` is now threaded end-to-end: derived from the persisted
  `init` event in `Storage` (no DB migration — it's read off the existing
  `role='init'` message row), serialized in the feedback HTTP projection, and
  carried through the dock transport. A new shared `isNotionalCost(apiKeySource)`
  helper is the single source of truth for "is this a billed run?", used by
  both the dock's `CostChip` (list row, detail header, and transcript `result`
  row) and the widget footer. For subscription runs the dock now shows
  `subscription` with the API-equivalent amount in the tooltip; API-key runs
  are unchanged.

- b624080: The dock now connects to the same WS server the widget does when the default port is taken.

  The widget learns its WS URL from a `window.__pinagentConfig` prelude the
  dev-server injects into `/__pinagent/widget.js`, so when the server falls back
  off the default port 53636 (because another/stale pinagent dev-server already
  holds it) the widget follows to the new port. The dock's `embedded.html` is
  served as a plain static file with no such injection, so the dock fell back to
  the hardcoded 53636 and silently talked to the _other_ server — out of sync
  with the widget and the project's real DB.

  Both plugins now inject the actually-bound WS port into the dock's
  `embedded.html` `<head>` as `window.__pinagentConfig`, mirroring the widget
  bundle. The dock also treats injected config as authoritative — an explicit
  `wsUrl: null` means "no WS here" rather than a cue to guess the default port
  and reach a stranger.

- be1349a: Redesign the anchored composer header and add quick-action chips.

  The widget that pops up next to a clicked element now leads with the
  picked element's identity (tag pill + quoted label), then the file
  location, then a DOM breadcrumb where the picked element is highlighted.
  Below the header sits a row of starter-prompt chips ("Change text",
  "Recolor", "Add hover state", "Resize", "Make it a link") that prefill
  the textarea so common edits skip the cold start. A "⌘↵ submit · esc
  cancel" hint replaces the bare button row in the footer.

  The submit binding moved from plain Enter to ⌘/Ctrl+Enter to match the
  hint — plain Enter now inserts a newline, which fits the longer prompts
  the new composer encourages.

  Brand colors are unchanged (cream/ink/gold); pure structural redesign.
  Both plugins embed the widget IIFE at build time, so the bundled bytes
  change even though no plugin source did — hence the patch bump.

- fa2b459: Polish the anchored composer: drag handle into the header + auto-grow
  textarea.

  The drag grip (now an 8-dot 2×4 SVG) moves from "above the iframe's
  top edge" to "inside the iframe's top-right corner", flush with the
  12px card padding so it reads as part of the header rather than a
  detached badge. The identity row reserves 28px of right padding so
  long element labels don't slide under it.

  The composer textarea now auto-grows as the user types. The iframe
  posts its textarea's natural scrollHeight to the parent via
  postMessage on every input + after a chip prefill; the parent clamps
  to [80, 240] px of textarea height (composer iframe height grows by
  the delta), reposition()s, and shrinks back down when content gets
  deleted. Past 240 px of textarea content, internal scrolling takes
  over rather than pushing the composer off-screen.

  Listener cleanup happens in close() — only the live composer's
  iframe.contentWindow can drive its size; messages from other windows
  or the stream pane are filtered out.

- 7519a1b: Quick-action chip prompts now quote the element's current state.

  Before, every chip dropped a generic prompt and the user had to
  restate the existing value:

  click "Change text" → `Change the text to: ` (then re-type old value + new)
  click "Change link" → `Change the link target to ` (re-type old href)

  Now the chip's prompt references the picked element directly:

  <button>Get started</button>
  click "Change text" → `Change the text from "Get started" to: `

  <a href="/docs">Read more</a>
  click "Change link" → `Change the link target from "/docs" to `

    <img src=".../logo.png?v=2" alt="Company logo">
      click "Change image"   → `Change this image (currently logo.png) to: `
      click "Edit alt text"  → `Change the alt text from "Company logo" to: `

    <input placeholder="Email address">
      click "Change placeholder" → `Change the placeholder from "Email address" to: `

  The user types only the _new_ value. Long button/heading text is
  truncated to a 60-char snippet so a paragraph-sized element doesn't
  flood the prompt. Image src is reduced to the filename (query string
  and CDN host stripped) for readability; data: URIs fall back to a
  plain truncation rather than splitting on the colon.

  The alt-text chip label also adapts: "Add alt text" when no alt is
  set, "Edit alt text" when one is.

  Under the hood, the chip catalog's `label` and `prompt` fields move
  from `string` to `(el: Element) => string`; `quickActionsFor` resolves
  both before returning the public `QuickAction` (which still exposes
  them as resolved strings). Static chips return constants, so the
  function-of-element shape doesn't leak complexity to call sites.

  12 new tests cover the per-element prompts plus the alt-text label
  flip, truncation, whitespace collapse, and the data:-URI edge case.
  Full widget suite is 97/97.

- 2ea96b0: Quick-action chips are now element-aware.

  Previously every picked element got the same 5 chips (Change text,
  Recolor, Add hover state, Resize, Make it a link) regardless of what
  made sense for it — "Change text" on an `<img>`, "Make it a link" on
  an `<a>` that already was one.

  The chip catalog moves to a new `quick-actions.ts` module. Each chip
  carries a `matches(el)` predicate; `quickActionsFor(el)` walks the
  catalog in order and returns just the chips whose predicate agrees.
  Recolor + Resize accept anything so the chip row is never empty; the
  rest specialize:

  <button> Change text · Recolor · Add hover state · Resize · Make it a link
  <a href="…"> Change text · Recolor · Add hover state · Resize · Change link
  <img> Change image · Add alt text · Recolor · Resize
  <input [ph]> Recolor · Add hover state · Resize · Change placeholder
    <h1>Hi</h1>    Change text · Recolor · Resize · Make it a link
    <div><btn>…    Recolor · Resize · Make it a link    (no Change text — outer div has no *own* visible text)

  Catalog order is preserved by the filter so chips appear in a
  predictable position regardless of which element you pick.

  Brand colors and layout unchanged; pure behavior expansion. 13 new
  unit tests on `quick-actions.test.ts` cover the predicates per
  representative element type.

- 3eefc69: Smooth out the agent widget's loading state: instead of showing an empty bordered box between submit and the first streamed event, the stream log is collapsed and the card hugs its header/footer, then grows the instant the agent's first output streams in.

## 0.2.0

### Minor Changes

- 8c028bf: Replace `better-sqlite3` with Node's built-in `node:sqlite` module
  (stable since Node 22.13; our `engines.node: ">=22.18.0"` already
  requires a compatible version). Same underlying SQLite engine and
  on-disk format — no data migration needed.

  Why: `better-sqlite3` ships a native `.node` binary that pnpm 10+
  blocks from compiling by default, producing a runtime
  `Could not locate the bindings file` 500 on the first feedback
  submission. Documented workaround was `pnpm approve-builds` +
  reinstall. With `node:sqlite`, fresh installs need no approval
  step at all.

  Wiring: drizzle-orm doesn't ship a node-sqlite adapter yet, so we
  route through `drizzle-orm/sqlite-proxy` with a small callback
  that delegates to `node:sqlite`'s `DatabaseSync`. The storage
  layer already `await`s every query, so call sites are unchanged.
  Migrations are applied by a tiny in-house migrator that mirrors
  the browser-side pattern (`packages/widget/src/db/migrations.ts`)
  and tracks applied versions in `__drizzle_migrations` (same shape
  drizzle's stock migrator writes).

  Verified: fresh `pnpm add -D @pinagent/vite-plugin` in a scratch
  project produces no `approve-builds` prompt and no native modules
  in the install graph. 224/224 tests pass.

### Patch Changes

- d045802: Widen the `vite` peer-dependency range from `^5 || ^6 || ^7` to
  `^5 || ^6 || ^7 || ^8` so fresh installs on the current Vite major
  don't trip a peer-dep warning. The plugin's Vite-API surface
  (plugin object, `configureServer`, `transform`) hasn't changed
  between major versions in a way that breaks us.

  Also: the root README's install section now mentions
  `pnpm approve-builds` for the `better-sqlite3` native build,
  since pnpm 10+ blocks postinstall scripts by default.

## 0.1.0

### Minor Changes

- a4a55cd: Bring `@pinagent/vite-plugin` to v2 parity with `@pinagent/next-plugin`.
  Each submitted comment now spawns a `@pinagent/agent-runner` SDK run
  that streams progress (text, tool calls, `ask_user` prompts, result/cost)
  into the widget over WebSocket — the same UX Next users get.

  Breaking-ish: the `autoTrigger` option is removed in favor of
  `spawnAgent: 'worktree' | 'inline' | 'off' | false` (default `'inline'`),
  mirroring `@pinagent/next-plugin`'s API. The old `AutoTrigger` class and
  its batching behavior are gone — runs are per-submit now, with isolation
  via the optional worktree mode.

  New middleware routes (all mirror `@pinagent/next-plugin/route`):

  - `POST /__pinagent/open` — spawn the developer's editor at file:line:col.
  - `GET /__pinagent/sqlite-wasm/<file>` — proxy sqlite-wasm jswasm files.
  - `GET /__pinagent/db-migrations` — drizzle migration journal + SQL.
  - `GET /__pinagent/db-worker.js` — SQLite-WASM worker source.

  `GET /__pinagent/widget.js` now ships a `window.__pinagentConfig` prelude
  with the WebSocket URL, identical to the Next plugin's bundle. The WS
  server boots on port 53636 (overridable via `PINAGENT_WS_PORT`) from
  `configureServer`; singleton-guarded so Vite restarts don't fight for
  the port.

  Drizzle migrations are now shipped with the package via a new prebuild
  step (`scripts/copy-drizzle.mjs`) that mirrors `packages/next-plugin/drizzle/`
  into `packages/vite-plugin/drizzle/`. Single source of truth, copied at
  build time, gitignored locally.

### Patch Changes

- 77a6e90: Inline `@pinagent/*` workspace packages into the published `next-plugin`
  and `vite-plugin` tarballs so end users don't need workspace packages
  available at install time. Workspace deps moved to `devDependencies`;
  the npm-shaped transitive deps (`@anthropic-ai/claude-agent-sdk`,
  `@babel/*`, `better-sqlite3`, `drizzle-orm`, `ws`, `zod`, `nanoid`) are
  declared as runtime `dependencies` on the consumer plugins. Verified by
  inspecting the built CJS bundles: no more `require("@pinagent/...")`
  calls in `dist/route.cjs` or `dist/index.cjs`.
- 64d17ce: Move `db-worker-source.ts` (the SQLite-WASM Web Worker source string) out
  of `@pinagent/agent-runner` and into `@pinagent/browser-runtime`, where it
  fits architecturally — the file is browser-side code, not agent runtime.
  `@pinagent/next-plugin/route` now imports `DB_WORKER_SOURCE` from
  `@pinagent/browser-runtime`; no externally observable change.
- 640e0d2: Phase G — re-anchor widgets on HMR / DOM rewrites. When the host app's
  framework replaces a widget's anchor Node (Vite HMR, React re-render,
  Next 16 RSC swap), the widget's rAF position loop now detects the stale
  reference (`composer.target.isConnected === false`) and tries to relocate
  the element by `data-pa-loc` first (precise `<file>:<line>:<col>` match
  from `@pinagent/babel-plugin`), CSS selector second. On success the new
  target is swapped in silently. On failure the bubble flips to a dashed
  amber "anchor-lost" ring with a tooltip prompting the user to click it
  and retry the lookup — visible failure instead of the widget freezing at
  stale coordinates.

  No protocol change. No server-side change. Pure widget IIFE work.

- f412e9f: Phase H finishing touch: surface the branch name and uncommitted-files
  count in the widget's lifecycle row, matching the v2 plan spec
  `pinagent/<id> · 3 changes · [Land] [Discard]`.

  Server (`@pinagent/agent-runner`) adds `countWorktreeChanges(worktreePath)`
  and includes the result as `changesCount` on `worktree_state` broadcasts
  emitted from the subscribe path. The widget uses it (alongside the
  `pinagent/<feedbackId>` branch name, which is deterministic) to render
  labels like `pinagent/abc123def · 3 changes` for `active`, and
  `Old worktree · pinagent/abc123def · 3 changes — review or discard` for
  `ttl_warning`. When the count is unknown (worktree gone, git failure)
  the count is omitted rather than guessed.

  Wire format change: `ServerMessage` of type `worktree_state` gains an
  optional `changesCount?: number` field. Backwards-compatible — older
  widgets/servers ignore the unknown field.

- 58e880d: Refactor: extract shared modules (`event-bus`, `ws-protocol`) into
  `@pinagent/shared`, the JSX transform + webpack loader into
  `@pinagent/babel-plugin`, and the Agent SDK runtime (agent, ws-server,
  storage, worktree management, `ask_user`, db client) into
  `@pinagent/agent-runner`. `@pinagent/next-plugin` is now a thin Next adapter
  over `@pinagent/agent-runner`; `@pinagent/vite-plugin` shares the same
  storage layer and JSX transform. No externally observable API changes —
  `@pinagent/next-plugin/loader` and `@pinagent/next-plugin/route` still
  work as before.
