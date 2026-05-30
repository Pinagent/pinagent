# @pinagent/next-plugin

## 0.3.0

### Minor Changes

- 346bbd7: Let the running-agents tray be minimized back to the pin. The tray gains a
  minimize button; when collapsed while agents are still live, the FAB pin shows
  a count badge plus a pulse ring (while any agent is working) so live runs stay
  glanceable, and a click re-expands the tray. The expanded default is unchanged —
  a newly-appeared agent (or the list emptying) auto-expands again, so a fresh run
  is never hidden behind a minimized pin.
- 832e583: Surface running inline-mode agents in the widget's running-agents tray. The FAB
  tray previously only morphed open for `worktree`-mode runs (which persist as
  `worktreeState: 'active'`); a default `inline`-mode agent runs as
  `(status: 'pending', worktreeState: 'none')`, which derives to the terminal
  `pending` and never appeared. The `GET /__pinagent/feedback` projection now
  carries an `isRunning` flag (true while an `active_runs` row exists), and
  `deriveDockStatus` folds it in as a top-precedence `working` state, so a live
  inline run shows in the tray (and the dock status badge) and clears the moment
  the turn ends. The agent runtime also emits `conversations_changed` on run
  start/finish so the tray re-fetches without waiting on the project poller.
- b29c2df: Add a `GET /__pinagent/git-branches` endpoint listing the repo's real git
  branches (local heads + origin remotes, normalized and de-duplicated). Feeds the
  PR composer's base-branch field, which now offers those branches as a dropdown
  while staying free-text so you can still target a branch git doesn't know yet.
- 3d026bd: Add a `POST /__pinagent/prs/refresh` endpoint that reconciles each recorded pull
  request's state against GitHub (open → merged / closed / draft) and returns the
  updated list. Backs the new "Refresh" button in the dock's PRs view, which until
  now showed whatever state was known when the PR was opened. Reuses the compose
  flow's GitHub token resolution and origin-remote detection; a no-op when no token
  or non-GitHub remote is configured.

### Patch Changes

- 9f4706c: Anchor-lost pins can now be opened (click to open the conversation in the dock) and dismissed (archive button removes the orphaned pin).
- 08145bb: Fix broken npm install: published artifacts depended on the unpublished `@pinagent/widget-dock@0.0.0` (404). `@pinagent/widget-dock` is now published, so `dock: true` resolves for installed consumers.
- 66399c8: Fix the minimized agent progress card clipping its status line. The mini
  card's content was a few pixels taller than its fixed height, so flexbox
  shrank the `overflow: hidden` header and sheared the "Working · model · id"
  text and spinner. The card now hugs its content height, and the header /
  context lines are pinned so they can never become flex-shrink victims.
- 08145bb: Publish `@pinagent/widget-dock` so the optional `dock: true` surface resolves for npm consumers.

  Both plugins resolve `@pinagent/widget-dock` at runtime (`require.resolve('@pinagent/widget-dock/package.json')`) to serve the dock's static assets, and declare it in `dependencies`. But the package was `private: true` and never published — so a clean `npm i @pinagent/next-plugin` (0.2.0) / `@pinagent/vite-plugin` (0.3.0) 404'd trying to fetch `@pinagent/widget-dock@0.0.0`. The core install was broken out of the box.

  `@pinagent/widget-dock` is now published. Its build (`vite build`) bundles everything into a self-contained static `dist/`, so it ships with **no** runtime dependencies — react, the TanStack packages, and the internal `@pinagent/*` packages (which are themselves unpublished) moved to `devDependencies`. A new `lint:published-deps` CI gate now fails if any published package lists a private/unpublishable workspace package in `dependencies`, so this class of broken-install can't ship again.

- 6d7b12e: The in-page widget no longer duplicates a conversation's transcript when its WebSocket reconnects.

  The dev-server replays a conversation's full transcript from the start on
  every fresh `subscribe`. On a reconnect the widget re-subscribed the open
  conversation, so the whole transcript was re-rendered onto the stream log
  it already had (and re-inserted into the browser-cache mirror, which then
  resurfaced the duplicates on the next page reload).

  `WidgetWsClient` now fires an `onReset` on each per-feedback handler before
  re-subscribing on a reconnect (not on the initial connect). The stream
  handler clears its rendered log and render accumulators and wipes the
  conversation's cached messages — serialised on one write chain so the
  delete lands before the replay re-inserts — letting the replay rebuild
  exactly one copy. This mirrors the dock-side fix and also self-heals events
  that arrived while the socket was down.

- b3a153a: refactor(widget): split the 3.2k-line `widget.ts` into focused modules

  Internal-only restructuring of `@pinagent/widget`. `widget.ts` shrinks from
  ~3230 lines to ~200 — it now only builds the DOM + a shared `WidgetContext`
  and wires three controllers together. Everything else moves to its own module:

  - `ws-client.ts` — the multiplexed page WebSocket
  - `stream-handler.ts` — transcript rendering + worktree lifecycle row
  - `composer.ts` — composer lifecycle (create/open/restore/swap/hop) + positioning
  - `composer-iframe.ts` — the composer iframe's internal form, submit, and stream wiring
  - `composer-html.ts` — composer HTML templating
  - `picker.ts` — the element-picking session
  - `fab-tray.ts` — the FAB and running-agents tray
  - `context.ts` — the shared `WidgetContext` + small shared types
  - `crop.ts`, `keyboard.ts`, `config.ts`, `constants.ts`, `pin-icon.ts`, `types.ts`

  The embedded widget IIFE is functionally unchanged — this bumps the consumer
  plugins only so the re-embedded bytes ship (per the widget-cascade rule).

- 8d871a1: The in-page widget now trusts the dev-server's injected WS config instead of guessing the default port.

  When the dev-server can't bind the default WS port 53636 (a stale or
  second pinagent dev-server already holds it) it walks to a fallback port
  and injects the actually-bound URL into the widget bundle as
  `window.__pinagentConfig`. The widget's `createWsClient` previously fell
  back to a hardcoded `ws://<host>:53636` whenever `wsUrl` was missing —
  which, when the config explicitly carried `wsUrl: null` ("this server has
  no agent WS"), connected the widget to whatever _other_ project's
  dev-server held 53636.

  `resolveWsUrl` now treats injected config as authoritative: an explicit
  `null` leaves the WS client inert (feedback capture still works; only live
  streaming is unavailable, which is correct when no agent runs here). The
  default-port guess survives only when no config was injected at all (a host
  page mounting the widget without the plugin prelude). Mirrors the dock-side
  hardening.

- Updated dependencies [832e583]
- Updated dependencies [08145bb]
  - @pinagent/widget-dock@0.1.0

## 0.2.0

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

## 0.1.0

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

## 0.0.21

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
