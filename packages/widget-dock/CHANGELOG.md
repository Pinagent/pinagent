# @pinagent/widget-dock

## 0.4.0

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

### Patch Changes

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

## 0.3.0

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

- d3a8238: Keep the dock dashboard's working-changes hero fresh with visibility-scoped polling.

  The hero reads live git state but, on its own, only refetched on pinagent
  lifecycle events, the Create-PR / Push actions, or a window-focus refetch
  (gated by a 60s staleTime) — so editing or reverting files directly in your
  editor left it stale until one of those fired. `useWorkingCopy` now sets a
  short `refetchInterval` (5s), which TanStack Query pauses automatically when
  the dashboard isn't mounted or the tab is backgrounded.

  Chosen over a server-side filesystem watcher: a watcher gives instant,
  focus-independent updates but holds OS watch handles on the whole tree for the
  entire dev session (and would add a dependency). Polling does a little
  redundant `git diff` work only while the dashboard is visible, costs nothing
  otherwise, and needs no extra dep — the better fit for a lightweight localhost
  tool. Worst-case staleness is ~5s while viewing.

## 0.2.2

### Patch Changes

- cd0cac9: Collapse agent tool calls in the conversation feed into a quiet, opt-in group so the transcript reads like a chat with the agent rather than a stream of machine activity. Consecutive `tool_use` / `tool_result` events now render as a single `N tool calls` line that expands on tap to show the individual calls — in both the in-page widget and the dock.

## 0.2.1

### Patch Changes

- c79f182: Replace the dock header's layout-mode dropdown and close control with a single X button that closes the dock.

## 0.2.0

### Minor Changes

- e92e7fc: feat(dock): ship the dock in dark mode

  The dock now renders dark by default, matching the dark-mode widget. The
  `.dark` class is applied on `<html>` across all three entry HTML files (dev
  preview, embedded iframe, standalone) so it paints dark on first frame with no
  light flash, and Storybook renders stories on the same dark surface.

  Because the shell, nav rail, and route screens already use semantic tokens
  (`bg-card`, `text-foreground`, `border-border`, …), the existing `.dark` token
  set in `@pinagent/ui` drives the whole UI. A few hardcoded light values that
  wouldn't follow the theme were fixed: the dev-preview host backdrop gradient
  (now `var(--secondary)`), an `ExtensionLaunch` hover (`bg-black/5` →
  `bg-foreground/10`), and the worktree-preview iframe fallback (`bg-white` →
  `bg-background`). The embedded-mode `color-scheme` is pinned to `dark`.

  `@pinagent/ui`: the `.dark` selector now sets `color-scheme: dark` so form
  controls, scrollbars, and UA chrome render dark wherever `.dark` is applied.

## 0.1.0

### Minor Changes

- 08145bb: Publish `@pinagent/widget-dock` so the optional `dock: true` surface resolves for npm consumers.

  Both plugins resolve `@pinagent/widget-dock` at runtime (`require.resolve('@pinagent/widget-dock/package.json')`) to serve the dock's static assets, and declare it in `dependencies`. But the package was `private: true` and never published — so a clean `npm i @pinagent/next-plugin` (0.2.0) / `@pinagent/vite-plugin` (0.3.0) 404'd trying to fetch `@pinagent/widget-dock@0.0.0`. The core install was broken out of the box.

  `@pinagent/widget-dock` is now published. Its build (`vite build`) bundles everything into a self-contained static `dist/`, so it ships with **no** runtime dependencies — react, the TanStack packages, and the internal `@pinagent/*` packages (which are themselves unpublished) moved to `devDependencies`. A new `lint:published-deps` CI gate now fails if any published package lists a private/unpublishable workspace package in `dependencies`, so this class of broken-install can't ship again.

### Patch Changes

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
