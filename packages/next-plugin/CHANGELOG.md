# @pinagent/next-plugin

## 0.10.0

### Minor Changes

- a92908f: Add an explicit, opt-in `apiKey` plugin option and stop reading the agent API
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

### Patch Changes

- e2de120: fix(widget): pressing Enter after multi-selecting nodes now reliably opens the composer

  When the picker was entered by clicking the pin, the FAB kept keyboard focus, so the Enter that commits a multi-node selection also bubbled to the FAB's keydown handler. By then the commit had flipped the mode to idle, so the FAB re-toggled straight back into picking — making Enter look like a no-op. The picker's Enter handler now stops propagation so committing the selection is its sole effect.

- 008a1bd: Widget: the `@`-mention file picker in the comment composer now drops down from
  the textarea's bottom edge instead of popping up above it, matching the
  conventional direction for a typeahead menu.
- c3d7078: fix(widget): the pin's keyboard activation no longer cancels an in-progress pick

  While picking, the picker owns the keyboard (Enter commits, Escape cancels). The pin keeps focus when a pick is started by clicking it, so a stray Space — or any Enter the picker didn't handle — used to re-toggle picking off and discard the user's pending multi-selection. The pin's Enter/Space handler now defers while a pick is in progress; cancelling stays available via Escape, the hotkey, or clicking the pin.

## 0.9.1

### Patch Changes

- 15eb766: Drop the composer card's drop shadow. The card fills its transparent iframe
  flush to the edges, so the `box-shadow` was rectangular-clipped by the iframe
  bounds and rendered as a hard-edged halo artifact around the anchored widget
  rather than a soft shadow. The card's 1px border carries its separation from
  the page instead; the needs-input/activity pulses keep their colored state
  rings (minus the clipped drop-shadow layer).
- 57eaf26: Pull a spawned agent's widget off the page when its anchored element is gone
  for good. Instead of leaving an orphaned "anchor lost" dot, the widget now
  freezes briefly (riding out transient HMR/re-render swaps) and then removes
  itself entirely — the conversation lives on in the FAB running-agents tray.
  Opening it from the tray with no dock mounted drops a free-floating,
  unanchored chat into the viewport rather than pinning it to a missing element.
- 454af34: Make the composer header breadcrumbs hoverable and pressable. Hovering any
  crumb flashes the matching element on the page; clicking an ancestor crumb
  re-focuses the comment onto that ancestor without re-picking, carrying the
  in-progress draft, extras and regions across. The affordance is only live on
  a fresh, unbound pick — once the conversation is submitted the breadcrumb
  reverts to a plain, non-interactive label.

## 0.9.0

### Minor Changes

- 5873372: Changes tab: open changed files in the editor + keep expanded diffs live.

  Each file header in an expanded Changes diff is now a button that opens that
  file in VSCode — at the **agent's edited version** in the worktree, not the
  workspace's pre-change copy (the diff endpoint now returns the worktree's
  absolute path; the link shows only when the Pinagent extension is present).
  Expanded diffs also refetch on `conversations_changed`, so a diff you're
  viewing stays current as the agent commits more, instead of going stale.

- c159148: Embed feedback screenshots in pull requests. When a PR is opened for feedback that has a screenshot, the PNG is committed onto the PR branch under `.pinagent/pr-assets/` and referenced from the PR body via its `?raw=true` blob URL — so the review shows the UI the developer actually clicked. The multi-conversation compose flow attaches every selected conversation's screenshot; the host-branch flow (dock "Create PR" and the MCP `create_pull_request` tool) attaches screenshots for any feedback whose resolution commit lands on the branch. GitHub-only and best-effort: it never blocks the PR if hosting the image fails.

### Patch Changes

- 5961da2: Fix the JSX source-location tagger producing unparseable output for generic components (`<Foo<T> .../>`). The `data-pa-loc` attribute was spliced at the element name, but TypeScript type arguments sit between the name and the attributes, so the tag landed inside the `<...>` and broke the dev build. It's now inserted after the type arguments. (The fix is in the bundled `@pinagent/babel-plugin`, so both plugins republish.)
- 1d6f994: Add a runtime `NODE_ENV === 'production'` guard to every Next route handler (GET/POST/PATCH/PUT/DELETE) so they're inert (404) in production even if the `route-noop` export condition isn't honoured by a custom server or bundler — a runtime belt to the existing build-time suspenders.
- 91983c6: Fix the element picker not resolving targets inside open shadow DOM. `document.elementFromPoint` returns a web component's shadow _host_, so clicking a control inside a component library (or any shadow tree) mis-anchored the feedback to the enclosing host element — or none. The picker now descends through open shadow roots to the real leaf. (The fix is in the bundled `@pinagent/widget`, so both plugins re-embed it.)
- df39f14: Fix screenshots never attaching to dock/working-copy PRs. The first cut matched feedback to the branch by `commit_sha`, but inline-mode feedback is never committed per-conversation (the change is committed by the PR step itself), so `commit_sha` was always null and nothing ever matched. The working-copy/dock "Create PR" now attaches screenshots for the resolved, inline, not-yet-shipped feedback sitting in the working copy, and stamps the shipped commit onto those records so a later PR won't re-attach them. Self-correcting and exact — no time/commit heuristics.
- ec07562: Re-anchor a feedback bubble to the picked `.map()` instance instead of always rebinding to the first row. When the same JSX literal renders several times, all live nodes share one `data-pa-loc`; the widget now uses the instance fingerprint captured at pick time (with the positional index as a fallback) to find the right node again on reload/re-anchor. (Ships via the bundled `@pinagent/widget`, so both plugins re-embed it.)
- 2971c99: Upgrade `@anthropic-ai/claude-agent-sdk` to `^0.3.161`.
- 5ae2c40: Surface connection-/project-level WebSocket `error` frames (the protocol allows an absent `feedbackId`) instead of silently dropping them. The widget and dock clients now `console.warn` a global server error that has no conversation to route to, so a relay/connection failure isn't invisible. (The widget half ships via the bundled `@pinagent/widget`, so both plugins re-embed it.)
- Updated dependencies [ea607f4]
- Updated dependencies [b85b843]
- Updated dependencies [5873372]
- Updated dependencies [803f684]
- Updated dependencies [a28b662]
- Updated dependencies [ef6bb6a]
- Updated dependencies [3c9c61f]
- Updated dependencies [bbb8104]
- Updated dependencies [27ae700]
- Updated dependencies [5ae2c40]
  - @pinagent/widget-dock@0.5.0

## 0.8.0

### Minor Changes

- 13e2636: Actually open the remote PR on "Create PR" via the `gh` CLI, and open it in the browser.

  Previously Create PR only opened a real GitHub PR when a token was configured
  (a dock-stored secret or `GITHUB_TOKEN`); developers authed only through the
  `gh` CLI just got a "branch pushed, open the PR yourself" compare link, and the
  button never flipped to **View PR** (no PR was recorded).

  `openPrOnGitHub` now falls back to **`gh pr create`** when no Octokit token is
  present (or the API call fails) — using the developer's existing `gh auth`, the
  way Claude Code opens PRs. The opened PR is recorded, so the dashboard's button
  switches to **View PR** (which opens the GitHub URL). Create PR also now opens
  the new PR in the browser on success. The `create_pull_request` MCP tool gets
  the same `gh` fallback.

- 0628a6a: Dashboard: show new (untracked) files, and name "Start a branch" from the changes.
  - `getWorkingCopyStatus` now includes **untracked files** in the file list and
    totals. `git diff` omits them, so a freshly-created file that Create PR would
    commit no longer goes missing from the hero. Counts respect `.gitignore` and
    read line counts without staging.
  - **"Start a branch"** now derives a readable slug from a summary of the working
    changes (e.g. `pinagent/add-pricing-tiers`) instead of `pinagent/<id>`, with a
    collision suffix when a name already exists. Falls back to the auto-id when no
    model/key is available.

- eaedf83: Refresh the PR description when pushing follow-up commits.

  "Push changes" previously committed + pushed but left the PR body frozen at
  whatever Create PR wrote. After a successful push, the dashboard now
  regenerates the description from the full branch diff (the same inline
  summarizer) and updates the open PR on GitHub — via Octokit when a token is
  set, otherwise `gh pr edit` — and mirrors it into the recorded PR row. The
  update is best-effort and never fails the push.

### Patch Changes

- ec33fdd: Standardize generated PR titles + commit messages as Conventional Commits.

  The dashboard's "Create PR" summarizer now produces titles in
  `type(scope): summary` form (e.g. `feat(dock): …`, `fix(widget): …`),
  choosing the scope from the changed file paths — matching the repo's commit
  convention. The same spec drives the inline commit-message generator (so the
  auto-commit subject is consistent) and the `create_pull_request` MCP tool's
  title guidance for the connected agent.

- a57be06: Reconcile PR state via the `gh` CLI, and auto-refresh the PRs tab.

  The PRs view's "Refresh" reconciled state through Octokit only, so for
  developers authed via the `gh` CLI (no stored token) it did nothing — a PR
  closed or merged on GitHub lingered as "open" in the dock. `refreshPullRequests`
  now falls back to `gh pr view --json` when there's no token. The PRs tab also
  reconciles once automatically when opened (the cached list renders immediately;
  the row updates when the reconcile lands), so state no longer silently lags.

- 2989bbb: Stop leaking pinagent's data dir into the dashboard/PRs, and handle detached HEAD.
  - **Self-ignore `.pinagent/`.** `getDb` now writes `.pinagent/.gitignore` (`*`)
    on first open, so git never sees the SQLite DB / screenshots / worktrees —
    regardless of whether the host project gitignored `.pinagent`. Without it,
    a project that hadn't gitignored `.pinagent` showed `db.sqlite` (+ `-wal`/`-shm`)
    as untracked changes in the dashboard and `git add -A` (Create PR / Push)
    committed them into the user's PR. `getWorkingCopyStatus` also defensively
    drops `.pinagent/*` from its untracked list (covers the first-request race).
  - **Detached HEAD.** The dashboard now shows a disabled "Create PR · Detached
    HEAD" instead of an enabled button that errored on click (e.g. a
    `git worktree add --detach`).

  Found via a worktree audit; the core worktree flows (branch resolution,
  commit-before-push, slug-collision suffix) were already correct.

- 8ba03fc: Fix Create PR / Push committing nested git repos as submodule gitlinks.

  The auto-commit step ran `git add -A`, which records any nested git repository
  in the tree — linked worktrees under `.claude/worktrees/`, vendored repos, an
  un-init'd submodule — as a gitlink ("Subproject commit …"). Opening a PR from
  a repo that contained other git checkouts spammed it with dozens of bogus
  `.claude/worktrees/*` subproject entries.

  `commitWorkingChanges` now unstages every newly-added gitlink (mode 160000,
  status A) after `git add -A` and before committing, so only real file changes
  land in the commit. Intentionally-tracked submodule pointer updates are left
  alone, and a commit whose only "changes" were embedded repos cleanly no-ops.

- de6ecbf: Link "Generated with Pinagent" in generated PR bodies to https://pinagent.dev.
- Updated dependencies [13e2636]
- Updated dependencies [a57be06]
- Updated dependencies [2989bbb]
  - @pinagent/widget-dock@0.4.0

## 0.7.0

### Minor Changes

- f5fa586: Auto-commit uncommitted changes when opening a PR or pushing from the dashboard.

  Create PR / Push previously only ran `git push`, so a PR opened from a dirty
  working tree silently omitted the uncommitted edits the dashboard was showing.
  Both actions now `git add -A` and commit those changes first (with an
  agent-generated message) so the PR actually contains them:
  - **Create PR** commits the working changes using the generated PR title as
    the commit message, then pushes + opens the PR.
  - **Push changes** generates a commit message for the uncommitted batch
    (inline agent), commits, then pushes. The button now also lights up on
    uncommitted edits (not just commits-ahead-of-remote).
  - The `create_pull_request` MCP tool gains an optional `commit_message`; when
    the tree is dirty the connected agent supplies it and the tool commits
    before pushing.

  Staging is `git add -A` (everything the dashboard lists); committing is fully
  automatic — no extra clicks.

- 1ec0fac: Add a "Start a branch" action to the dashboard when you're on the base branch.

  Previously the primary button was disabled (`Create PR · On main`) when the
  dev server was on the base branch, since you can't open a PR from main onto
  main. It now offers **Start a branch**: it creates a fresh feature branch and
  switches to it, carrying your uncommitted working changes over (leaving the
  base branch clean, via `git switch -c`). The hero then re-derives onto the new
  branch and the button flips to **Create PR**. The auto-generated
  `pinagent/<id>` name is fine — the eventual Create PR supplies the real,
  agent-summarized title. Backed by `POST /__pinagent/working-copy/branch` in
  both plugins.

- dbb238d: Redesign the dock dashboard around the working branch's git changes.

  The Overview now leads with a working-changes hero for the branch the
  dev-server is on: changed files (with per-file open-in-VSCode links), +/−
  stats, ahead/behind the remote, and a state-aware primary action — **Create
  PR** (an inline agent summarizes the diff and opens a PR via the configured
  GitHub token), which becomes **Push changes** when local commits are ahead
  of the remote and **View PR** once it's up to date. An "Open in VSCode"
  button focuses the Source Control view via a new `view-changes` extension
  command. The same PR core is exposed as a `create_pull_request` MCP tool, so
  a connected Claude Code session can open the PR after summarizing the diff
  itself.

  New dev-server endpoints back this: `GET /__pinagent/working-copy`,
  `POST /__pinagent/working-copy/pr`, and `POST /__pinagent/working-copy/push`
  (mirrored across the Vite and Next plugins).

### Patch Changes

- 98e0f61: Fix an un-submitted composer collapsing into a broken, clipped card. Pressing the pick hotkey (`c`) while a freshly spawned composer was open — and picking another element — minimized that draft. Its minimal bar lives inside the still-hidden stream pane, so it collapsed to a stuck, empty "bugged out" state. A pre-submit draft has no conversation to preserve, so it's now discarded (like Esc already does) instead of minimized.
- 678bb53: Fix "project root is not a git repository" when opening a PR from a subdirectory or linked worktree.

  `openHostBranchPr` / `pushHostBranch` (the dashboard's Create PR / Push
  actions) and `composePullRequest` guarded on `existsSync(projectRoot/.git)`,
  which is false when the dev server runs from a subdirectory of the repo (e.g.
  an example app) or a linked worktree (where `.git` is a file at the worktree
  root, absent in subdirs). They now detect the repo with
  `git rev-parse --is-inside-work-tree` (a shared `isInsideWorkTree` helper),
  matching the working-copy status reader. The same fix applies to the
  `create_pull_request` MCP tool.

- Updated dependencies [f5fa586]
- Updated dependencies [1ec0fac]
- Updated dependencies [dbb238d]
- Updated dependencies [d3a8238]
  - @pinagent/widget-dock@0.3.0

## 0.6.2

### Patch Changes

- cd0cac9: Collapse agent tool calls in the conversation feed into a quiet, opt-in group so the transcript reads like a chat with the agent rather than a stream of machine activity. Consecutive `tool_use` / `tool_result` events now render as a single `N tool calls` line that expands on tap to show the individual calls — in both the in-page widget and the dock.
- Updated dependencies [cd0cac9]
  - @pinagent/widget-dock@0.2.2

## 0.6.1

### Patch Changes

- Updated dependencies [c79f182]
  - @pinagent/widget-dock@0.2.1

## 0.6.0

### Minor Changes

- 53379b0: feat(widget): dark-mode redesign matching the dock

  The in-page widget now renders in dark mode, matching the dock's dark theme —
  deep ink surfaces (`#201B21` / `#2A2528`), cream text, gold accent. The
  composer card, header pills, breadcrumb, quick-action chips, textarea, stream
  log, @-mention menu, follow-up bar, minimized bubbles, drag handle, tray,
  hint, and toast were all reskinned; primary buttons invert to cream-on-ink for
  a strong CTA on dark. The shadow root and composer iframe now opt into
  `color-scheme: dark`.

  A dark-tuned status palette (`STATUS_DARK`) was added to `@pinagent/ui/tokens`
  (mirroring the `.dark` status block in `globals.css`) so the widget's status
  dots, bubbles, and lifecycle chips read on the dark surfaces without drifting
  from the dock.

- 02bc4f1: feat(widget): numbered multi-node badges + region snip selection

  Multi-picking now stamps each selected element with a gold "1, 2, 3…" order
  badge (on the page and in the "+N" hover popover). A new region-snip mode
  (press `R` while picking) lets you drag out a rectangle to capture a specific
  section of the page; `Enter` commits the selection (handy for region-only
  snips). Regions are composable with element picks — the submitted screenshot
  is cropped to the union of the drawn region(s) and any picked elements. The
  crop is baked into the uploaded image, so nothing new is persisted server-side.

### Patch Changes

- 9f0be42: feat(widget): lay the composer footer shortcut hints out in a 2×2 grid

  The keyboard-shortcut hints under the composer textarea now render as a 2×2
  grid instead of a single inline row. The fourth cell surfaces the `c` comment
  hotkey alongside the existing `↵ submit`, `⇧↵ newline`, and `esc cancel` hints.

- 22259ed: fix(widget): make dock shortcuts work across iframe focus boundaries

  Keyboard shortcuts are registered per JS realm (host document, dock iframe,
  composer iframe) and iframe keystrokes never bubble to the host, so a shortcut
  only fired when focus happened to sit in the realm that handled it. Two gaps
  are closed:
  - **Cmd/Ctrl+Shift+P now toggles the dock from a spawned agent.** The composer
    iframe (a spawned agent's UI) handled `Esc` / `c` / `Shift+N` / `Ctrl+\`` but
    not the dock toggle, so the shortcut was dead while focus was inside it. It
    now relays to the dock like the other composer-iframe shortcuts.
  - **Pressing the pick hotkey (`c`) while the dock is open now opens a usable
    picker.** Entering the picker hides the dock iframe (rather than closing it,
    so the dock's React tree and any unsaved reply draft survive) so a
    fullscreen/floating dock no longer occludes the page being picked; it is
    restored when picking ends.

- 7f7c94f: Remove the quick-action suggestion chips from the composer

  The per-element composer no longer renders the "Recolor / Resize / Make it a
  link" quick-action chips above the textarea. The `quick-actions.ts` catalog,
  its tests, the `chips` field on `ComposerMeta`, the chip rendering/wiring, and
  the `.qa-chip` styles are all gone — the composer now opens straight to the
  "Describe the change you want…" textarea. Bumps both consumer plugins so the
  new widget IIFE ships.

- Updated dependencies [e92e7fc]
  - @pinagent/widget-dock@0.2.0

## 0.5.0

### Minor Changes

- 373027c: feat(widget): walk the picker highlight up the ancestry with ↑/↓

  `document.elementFromPoint` always returns the innermost element under the
  cursor, so a parent that a descendant visually covers — e.g. a `<nav>`,
  `<aside>`, or `<div>` fully filled by the `<a>` inside it — was impossible
  to hover or select. Picking now tracks the chain of source-tagged
  (`data-pa-loc`) ancestors for the hovered element: ↑ walks the highlight
  outward to the enclosing element, ↓ back toward the cursor, and a click
  commits whichever level is currently highlighted. Moving the mouse rebuilds
  the chain and snaps back to the hovered element. The pick hint advertises
  ↑/↓ whenever a parent exists and shows the targeted tag once you climb.

### Patch Changes

- 4b51350: fix(widget): make "Add another element to this conversation" work

  The expanded-widget footer button that adds another picked element to a
  running conversation did nothing. It handed off to the picker via a
  `postMessage` to the host window, but the composer iframe runs no scripts
  of its own — the button's handler executes in the host realm, so the
  message arrived with `event.source === window` rather than
  `iframe.contentWindow`, and the receiving guard dropped it. The handler
  now calls the picker controller directly (it already had the context and
  composer in scope), so picking an element joins the conversation as a
  queued follow-up as intended.

- 93d4ac7: fix(widget): composer auto-grow, dot needs-input state, pick-into-draft

  Three follow-on fixes to the spawned-agent widget:
  - **Auto-grow no longer runs away.** The pre-submit composer textarea is
    `flex: 1`, so measuring its `scrollHeight` reported the flex-filled height,
    which grew the iframe, which re-filled the textarea — looping bigger on every
    keystroke. The measure now drops the textarea out of flex to an auto height,
    so it reflects the content and settles (capped at MAX_TA_H).
  - **Collapsed dot:** the running spinner is smaller, and when the agent asks a
    question (`ask_user`) the dot now shows a distinct needs-input state (alert
    glyph + attention pulse) instead of the spinner, mirroring the minimal bar.
  - **Adding an element when idle opens a draft.** Picking another element after
    the agent finished no longer auto-fires a bare "Also look at this…" turn; it
    attaches the element as a removable pill and focuses the follow-up input so
    you can describe the change, then folds the element reference into your
    message on send. Mid-turn picks still queue as before.

- 6228c2a: fix(widget): submit the composer prompt with plain Enter (Shift+Enter for a newline)
- 6d40d1f: feat(widget): `@`-mention file picker in the composer

  Type `@` in the composer (the initial "describe the change" box and the
  follow-up reply box) to get an autocomplete of project files — the browser
  analogue of Claude Code's own `@`. Picking a file inserts its path into the
  prompt so the agent gets an exact `file` reference; picking a directory keeps
  the menu open to drill in. A query starting with `/` or `~` browses the real
  filesystem instead of project files (the "reach anywhere" mode), which is safe
  because the dev server is localhost-only.

  Backed by a new `GET /__pinagent/files` endpoint (in both plugins) over a
  shared `listProjectFiles` helper: `git ls-files` for project mode (respects
  `.gitignore`, with an `fs`-walk fallback for non-git projects) and a directory
  listing for path mode. The same picker is also wired into the dock's
  conversation reply box.

- d68d610: fix(widget): restore composer auto-grow and the "+N" extras hover-flash

  These shared the root cause fixed for the add-element picker: the composer
  `srcdoc` iframe runs no scripts of its own, so its event handlers execute
  in the host realm. Their `iwin.parent.postMessage(...)` calls therefore
  arrived with `event.source === window` (not `iframe.contentWindow`) and
  were dropped by the receiving `ev.source` guard — so the composer textarea
  never grew to fit a multi-line comment, and hovering the "+N more" badge
  didn't flash the extra picked elements on the page.

  The iframe wiring now calls the controller directly (`onTextareaHeight`,
  `onExtrasHover`, `onExtrasLeave`) instead of posting messages, and the
  now-dead `onIframeMessage` listener and its broken guard are removed.

- 60f4d94: widget: add Control+` shortcut to minimize all spawned agents to their bubble state
- 327517d: feat(widget): smaller, draggable minimized agent bar

  The single-line minimal bar (`viewState: 'minimal'`) shown for a spawned agent
  is now more compact and can be repositioned by hand:
  - **Smaller.** The status spinner shrinks (13px → 10px, thinner stroke) and the
    card's vertical padding tightens (8px → 4px), dropping the bar's height from
    46px to 36px (`MINI_H`).
  - **Draggable.** A leading grip now rides the left edge of the minimized bar, so
    it can be dragged to reposition exactly like the expanded composer (same
    `userOffset` machinery). Clicking elsewhere on the bar still expands it; the
    grip is hidden only when the widget collapses to a floating dot.

## 0.4.0

### Minor Changes

- ef98fba: feat(widget): redesign the spawned-agent widget into three explicit states

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

### Patch Changes

- 423f190: fix(db): don't re-run migrations on DBs created by an earlier build

  The bundled migrator now decides "already applied?" by the
  `__drizzle_migrations.created_at` watermark (drizzle's own semantics, and
  what the browser-side mirror already does) instead of matching the stored
  `hash` value. An earlier Pinagent build wrote the migration _tag_ into the
  `hash` column rather than `sha256(rawSql)`; keying on the hash value treated
  those rows as unknown, re-ran migration 0000, and crashed with
  `table active_runs already exists` — 500-ing every `POST /__pinagent/feedback`
  and silently blocking the agent. Such legacy DBs now upgrade cleanly in place.

- 393a4d5: fix(widget): keep the answer affordance when minimizing mid-question

  When the agent asked a question (`ask_user`) while the conversation was
  expanded and the user then minimized it, the single-line minimal bar showed a
  stop icon for a not-actually-running agent instead of the alert + answer icon.
  The pending-ask state now lives on the composer (`needsInput`), so
  `applyMiniChrome` re-applies the `needs-input` attention state on minimize and
  clears it on expand/answer.

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
