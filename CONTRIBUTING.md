# Contributing to Pinagent

Thanks for your interest in contributing. This repo is a pnpm workspace with two
licensing zones — read the layout section before you open a PR so your patch lands
in the right place.

## Repository layout

- `packages/*` — Apache License 2.0. Open source. External contributions welcome.
- `examples/*` — Apache License 2.0. Sample apps used for smoke-testing the OSS packages.
- `apps/cli/` — Apache License 2.0. Wraps the OSS packages as a CLI.
- `ee/` and `apps/cloud/` — Elastic License v2. Source-available, not open source.
  We do not accept external pull requests against these directories.

See [LICENSE](./LICENSE) (root, Apache-2.0) and [ee/LICENSE](./ee/LICENSE)
(Elastic-2.0) for full terms.

## Contributor License Agreement

By submitting a pull request, you agree to the [Pinagent Contributor License Agreement](./.github/CLA.md).
The CLA bot will prompt you to sign on your first PR. The CLA grants us permission to
relicense your contribution under Apache-2.0 or Elastic-2.0 — without it we can't
move code between the two zones.

## Development setup

Prereqs: Node 22+ (`.nvmrc` pins it; `engines.node` is `>=22.18.0`) and pnpm 10+ (`packageManager` in `package.json` pins `pnpm@10.14.0`).

```bash
pnpm install
pnpm typecheck
pnpm build
pnpm test
pnpm lint
```

`pnpm lint` runs biome (formatting + lints) over the whole repo. If you want CI's full pre-merge check, the other `lint:*` scripts in `package.json` cover SPDX headers, workspace deps, undeclared imports, and peer-dep resolution.

Every source file must carry an SPDX license header (`// SPDX-License-Identifier: Apache-2.0` for OSS code, `Elastic-2.0` under `ee/` and `apps/cloud/`). `pnpm lint:spdx` enforces this — copy a header from a neighbouring file when you add a new source file.

Run an example app against the local packages:

```bash
pnpm example                # examples/react-vite on :5173
pnpm --filter next-app-example dev   # examples/next-app
```

## Commit style

Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`).
One logical change per commit. Keep diffs focused — unrelated cleanup belongs in
its own commit so it can be reviewed and reverted independently.

## Changesets

If your PR touches a publishable package under `packages/*`, add a changeset:

```bash
pnpm changeset
```

Pick the affected packages, choose patch/minor/major, and write a one-line
summary. The changeset file is committed with your PR; release tooling consumes
it later. Packages under `ee/*` and `apps/cloud/` are excluded from changesets
because they're not published to npm.

## Tests

Vitest runs at the root and picks up `packages/*/tests/**/*.test.ts` automatically.
Add tests next to the package they cover. Tests that need a DOM annotate the file
with `// @vitest-environment happy-dom` at the top.

## Security

Please don't open public issues for security problems. See [SECURITY.md](./SECURITY.md)
for the disclosure process.
