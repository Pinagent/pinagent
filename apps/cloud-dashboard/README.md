<!-- SPDX-License-Identifier: Elastic-2.0 -->

# @pinagent/cloud-dashboard

Admin dashboard for the Pinagent hosted control plane (`apps/cloud`).

Licensed under the [Elastic License v2](../../LICENSE) — source-available, not
open source. See [`ee/README.md`](../../ee/README.md) for the licensing
boundary; this app lives in the Elastic zone (no external PRs).

## What it is

A small Next.js 16 (App Router) + Tailwind v4 SPA over the control plane's
read + config API. It surfaces, per organization:

| Route       | Shows                                                              |
| ----------- | ----------------------------------------------------------------- |
| `/`         | Usage stats, the member roster, and the **invite members** form   |
| `/billing`  | Subscription/plan + cost controls (read + edit)                   |
| `/policy`   | Branch-routing policy (read + edit)                               |
| `/audit`    | Recent audit events                                               |

The active org is read from `?org=`; a header **org switcher** (`/me/orgs`)
moves between the orgs you belong to, and the no-org landing redirects to your
first org. Styling comes from the shared `@pinagent/ui` (shadcn) library — see
the dashboard styling notes in that package.

## Auth + the API proxy

The browser calls the control plane with the session cookie set by the SSO
login flow (`credentials: 'include'`). To keep that a same-origin request, the
control-plane routes are **proxied** via `next.config.ts` `rewrites()` — the
`API_PREFIXES` list (`me`, `usage`, `members`, `invitations`, `audit`,
`subscriptions`, `cost-controls`, `branch-routing`, `sso`) is forwarded to
`CLOUD_API_ORIGIN`. **Adding a new endpoint? Add its prefix there too.**

```bash
CLOUD_API_ORIGIN   # control-plane origin (default http://127.0.0.1:8787, i.e. `wrangler dev`)
```

## Develop

```bash
pnpm --filter @pinagent/cloud-dashboard dev        # http://localhost:3031
# point it at a running control plane:
CLOUD_API_ORIGIN=http://127.0.0.1:8787 pnpm --filter @pinagent/cloud-dashboard dev
```

Open with an org selected, e.g. `http://localhost:3031/?org=acme` (or just `/`
and let the gate redirect once you're signed in).

Env keys are documented in [`.env.example`](.env.example) (only `CLOUD_API_ORIGIN`
today; kept in sync by `pnpm lint:env-example`). Next reads `.env.local`, or run
through Doppler — `doppler run --config dev -- pnpm --filter @pinagent/cloud-dashboard dev`.

## Structure

- `app/` — App Router routes (`page.tsx` server components) + `_components/`
  (chrome: `PageShell`, `Nav`, `OrgSwitcher`, `OrgGate`). Each page wraps
  `PageShell` and renders a thin `'use client'` boundary that constructs the
  cookie-bearing api-client.
- `src/` — framework-agnostic core: `api-client.ts` (typed client), the pure
  views + data-loading containers (`Overview`, `Billing`, `Policy`, `Audit`,
  `MembersAdmin`), edit forms, and helpers (`format`, `forms`, `states`,
  `form-controls`, `KeyValue`, `use-async`, `org-switcher-model`).

The split is deliberate: each surface is a **pure `*View`** (rendered in tests
via `react-dom/server`) plus a container that loads data. Tests assert on
text/values, not class names, so styling changes stay behavior-preserving.

## Test / check

```bash
pnpm exec vitest run apps/cloud-dashboard
pnpm --filter @pinagent/cloud-dashboard typecheck
pnpm --filter @pinagent/cloud-dashboard build      # the real Tailwind/transpile gate
```
