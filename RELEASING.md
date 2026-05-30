# Releasing

How the publishable `@pinagent/*` packages get to npm. (For *adding* a
changeset to a PR, see [CONTRIBUTING.md](./CONTRIBUTING.md) — that's the
per-PR step; this is the cut-a-release step.)

## What publishes

The OSS packages: `@pinagent/vite-plugin`, `@pinagent/next-plugin`,
`@pinagent/nuxt-plugin`, `@pinagent/widget-dock`, `@pinagent/mcp`, and
`@pinagent/cli`. Everything under `ee/*` and `apps/cloud/`, plus the
internal libs in `.changeset/config.json`'s `ignore` list (`widget`,
`shared`, `agent-runner`, …), is **not** published — those are either
private or bundled into a publishable package's `dist` at build time.

`changeset publish` decides what to publish by comparing each package's
current version against the registry — anything not already on npm goes out.
It is **not atomic**: it attempts every pending package and reports failures
at the end, so a failure on one package does not stop its dependents from
publishing. The preflight below exists to stop that from shipping a broken
registry.

## Prerequisites

- **npm auth that can create AND update `@pinagent` packages.** `npm whoami`
  must succeed, and the identity must be an owner/admin of the `@pinagent`
  org. A granular token scoped to *existing* packages can publish new
  versions but **404s when creating a new package name** — re-`npm login` as
  an org owner before a release that introduces a new package.
- Clean `main`, up to date with `origin/main`.
- All pre-flight gates green (`pnpm lint:*`, `pnpm typecheck`, `pnpm test`,
  `pnpm build`).

## Cutting a release (manual)

```bash
# 1. Consume changesets → bump versions + write CHANGELOGs.
pnpm version-packages          # = changeset version
#    Review the diff: versions, CHANGELOG entries, and that internal
#    `workspace:*` deps still point where you expect.

# 2. Commit the version bump.
git add -A && git commit -m "chore(release): version packages"

# 3. Build, preflight, publish, and smoke-test — all via `pnpm release`.
pnpm release

# 4. Push the version commit + the tags `changeset publish` created.
git push origin main --follow-tags
```

`pnpm release` runs four steps in order and stops on the first failure:

| Step | Script | What it guards |
| --- | --- | --- |
| build | `build:oss` | publishable `dist/` is fresh |
| preflight | `release:preflight` (`check-release-preflight.mjs`) | blocks the publish if a **new package name** isn't acknowledged, or an internal dep wouldn't be on npm (broken-install closure) |
| publish | `changeset publish` | the actual npm publish + git tags |
| smoke | `release:smoke` (`smoke-install-published.mjs`) | clean-room `npm install` of each published package proves it resolves on the registry |

### First-publish acknowledgement

If the release introduces a **new** package name, preflight blocks with the
new names listed. Confirm your npm auth can create them, then:

```bash
PINAGENT_RELEASE_ALLOW_NEW=1 pnpm release
```

This is deliberate friction — a new scoped package needs org create-rights,
and getting that wrong is what caused the partial release below.

## Recovering from a partial publish

If `changeset publish` published some packages but not others (e.g. the new
ones failed on create-permission while existing ones updated), the registry
is in a broken state — published packages may point at a dependency that
never shipped. Both `release:preflight` (before) and `release:smoke` (after)
are designed to catch this, but if it happens:

```bash
# 1. Fix the cause — almost always auth. Re-login with create rights:
npm login                      # confirm: npm whoami (must be an @pinagent owner)

# 2. Re-run — publish is idempotent: it skips what's already on npm and
#    retries only the missing packages.
pnpm release

# 3. Push the tags the retry created.
git push origin main --follow-tags

# 4. Verify the previously-broken installs now resolve:
npm view @pinagent/widget-dock version
#    or, in a scratch dir:  npm install @pinagent/<pkg>@<version>
```

> **Publish dependencies first.** When a release adds a new package that
> others depend on (e.g. `widget-dock`, which `next-plugin`/`vite-plugin`
> `require.resolve` at runtime), make sure that package actually lands before
> — or in the same atomic run as — its dependents. Otherwise the dependents
> go live pointing at a version that isn't there yet.

## Automated releases (CI)

[`.github/workflows/release.yml`](./.github/workflows/release.yml) is the
Changesets GitHub Action. Merging changesets to `main` opens a "Version
Packages" PR; merging that PR publishes via `pnpm release` (same preflight +
smoke steps) from CI.

Auth is **npm Trusted Publishing (OIDC)** — there is **no `NPM_TOKEN`
secret**. npm verifies a short-lived GitHub OIDC token against the
trusted-publisher config registered on each package (repo `Pinagent/pinagent`
+ workflow `release.yml` + `production` environment) and mints per-run
credentials; provenance is attached automatically. This is strictly safer
than a long-lived token (nothing to leak, rotate, or over-scope — the cause
of the manual-release failures above).

Requirements baked into the workflow: `permissions: id-token: write`, the job
runs in the `production` environment (to match the OIDC claim), and npm is
upgraded to ≥ 11.5.1 (Node 22 ships npm 10, which predates OIDC publishing).
The preflight skips its `npm whoami` gate under OIDC (no logged-in user until
publish) and the new-package gate is pre-acknowledged via
`PINAGENT_RELEASE_ALLOW_NEW=1`.

> **One-time setup:** add a Trusted Publisher to **each** published
> `@pinagent/*` package on npmjs.com (repo + `release.yml` + `production`),
> create the `production` GitHub Environment, and allow Actions to open PRs
> (Settings → Actions → Workflow permissions). Leave the `production`
> environment without required reviewers unless you want every release to
> pause for manual approval. **Verify the first run** actually publishes via
> OIDC — `changeset publish` must invoke the upgraded npm; if a publish step
> reports needing auth, confirm npm ≥ 11.5.1 is on PATH in the job.
