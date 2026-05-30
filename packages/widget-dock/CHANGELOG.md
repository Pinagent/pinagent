# @pinagent/widget-dock

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
