# @pinagent/mcp

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

- ec33fdd: Standardize generated PR titles + commit messages as Conventional Commits.

  The dashboard's "Create PR" summarizer now produces titles in
  `type(scope): summary` form (e.g. `feat(dock): …`, `fix(widget): …`),
  choosing the scope from the changed file paths — matching the repo's commit
  convention. The same spec drives the inline commit-message generator (so the
  auto-commit subject is consistent) and the `create_pull_request` MCP tool's
  title guidance for the connected agent.

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

- 678bb53: Fix "project root is not a git repository" when opening a PR from a subdirectory or linked worktree.

  `openHostBranchPr` / `pushHostBranch` (the dashboard's Create PR / Push
  actions) and `composePullRequest` guarded on `existsSync(projectRoot/.git)`,
  which is false when the dev server runs from a subdirectory of the repo (e.g.
  an example app) or a linked worktree (where `.git` is a file at the worktree
  root, absent in subdirs). They now detect the repo with
  `git rev-parse --is-inside-work-tree` (a shared `isInsideWorkTree` helper),
  matching the working-copy status reader. The same fix applies to the
  `create_pull_request` MCP tool.

## 0.2.1

### Patch Changes

- b8c67f8: fix(mcp): surface multi-selected elements to the agent

  When a developer Cmd/Ctrl-clicks several elements and leaves one comment, the
  extra picks (`additionalAnchors`) were captured and persisted but never told to
  the agent, so only the primary element got changed.

  The channel notification now includes an `additionalTargets` attribute (a
  comma-separated `file:line:col` list) and the channel instructions direct the
  agent to address every target before resolving. The inline `agent-runner`
  prompt enumerates the same extras as numbered targets.

## 0.2.0

### Minor Changes

- cf3dc7e: `get_feedback` now surfaces enclosing-component and loop-instance
  context when present: the `component` name, the `component path`
  (outer→inner chain), and — when the target's `file:line` is shared by
  several rendered instances — which instance the developer clicked plus a
  content fingerprint. This helps an MCP-driven agent edit the correct
  `.map()` item rather than the first match. Fields are omitted for
  single-pick / uninstrumented feedback, so existing output is unchanged.

### Patch Changes

- 99a1519: Publish `@pinagent/cli` and fix `@pinagent/mcp` packaging.

  `@pinagent/mcp@0.1.0` was uninstallable from npm: it declared the private,
  unpublished `@pinagent/db` (and `@pinagent/shared`) as runtime `dependencies`,
  so a clean `npm install @pinagent/mcp` failed with a 404 on `@pinagent/db`.
  Those internal packages now live in `devDependencies` so tsdown bundles them
  into the published dist (the same pattern `@pinagent/vite-plugin` and
  `@pinagent/next-plugin` already use). A clean install now resolves with no
  dangling internal dependencies.

  `@pinagent/cli` becomes publishable (was `private`): it adds
  `publishConfig.access: public` and a `prepare` build hook, keeps a thin runtime
  dependency on `@pinagent/mcp`, and bundles `@pinagent/shared`. This makes
  `pnpm dlx @pinagent/cli mcp` (and `pinagent init` / `pinagent transcript`)
  work without a local checkout.

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

## 0.0.2

### Patch Changes

- 6520e38: Export `startMcpServer` so `@pinagent/cli`'s new `pinagent mcp` subcommand
  can drive the server in-process. The package's bin entry still auto-starts
  when invoked directly (`pinagent-mcp`), gated by an `import.meta.url` check
  that skips the auto-start when the module is imported as a library.
