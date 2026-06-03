<!-- SPDX-License-Identifier: Elastic-2.0 -->

# @pinagent/cloud

The Pinagent hosted **control plane** — a Cloudflare Worker that authenticates
developers via SSO, issues relay session tokens, and exposes the admin
read/config API the [dashboard](../cloud-dashboard) renders.

Licensed under the [Elastic License v2](../../LICENSE) — source-available, not
open source (see [`ee/README.md`](../../ee/README.md) for the boundary). This
app is the composition root for the Elastic-zone `@pinagent/ee-*` packages; it
runs as a hosted multi-tenant service, so no external PRs.

## What it does

1. **Login** — drives an OIDC `SsoProvider`: `/sso/start` → IdP → `/sso/callback`
   provisions the user and sets a signed **user-token** cookie.
2. **Session exchange** — `/sessions` turns that cookie into a short-lived
   **relay session token** the browser/dock uses to reach a dev machine through
   the relay, gated by membership + RBAC + plan quota + cost controls.
3. **Admin API** — org-scoped reads (usage, audit, members, my-orgs) + config
   (subscription, cost controls, branch routing) + team management
   (invitations, member role/remove).
4. **Service-to-service** — internal endpoints the relay and a cron call.

## HTTP surface

All app routes are dispatched in [`src/app.ts`](src/app.ts); each handler is a
framework-agnostic `(Request, deps) => Response`.

| Route | Method | Auth | Purpose |
| --- | --- | --- | --- |
| `/sso/start`, `/sso/callback` | GET | signed `state` | OIDC login → user-token cookie |
| `/sessions` | POST | user-token cookie | exchange for a relay session token |
| `/usage` | GET | `billing:read` | metered usage summary |
| `/audit` | GET | `org:settings` | recent audit events |
| `/members` | GET | `org:settings` | roster (enriched with name/email) |
| `/members?userId` | PATCH / DELETE | `member:invite` / `member:remove` | change role / remove (owner-gated) |
| `/invitations` | GET / POST / DELETE | `org:settings` / `member:invite` / `member:remove` | list / invite / revoke |
| `/me/orgs` | GET | authenticated | the caller's own organizations |
| `/subscriptions`, `/cost-controls`, `/branch-routing` | GET / PUT | `billing:*` / `org:settings` | read/set org config |
| `/internal/relay/events` | POST | `RELAY_INTERNAL_SECRET` | relay lifecycle ingest (audit + connection metering) |
| `/internal/billing/roll` | POST | `BILLING_INTERNAL_SECRET` | advance elapsed billing periods |
| `/healthz` | GET | — | liveness |

Org-scoped endpoints take `?organizationId=`; admin endpoints resolve the
caller's membership and check a `Permission` via `authorizeOrgMember`.

## Architecture

Handlers are **pure, fully-injected services** (`*-service.ts`); the Worker
([`src/worker.ts`](src/worker.ts)) is the only place that touches the
environment — it builds the Neon pool, constructs every adapter, and wires the
dependency graph into `createCloudApp`. This keeps the services unit-testable
with in-memory fakes.

Persistence follows one pattern throughout: a **driver-free port + in-memory
impl** lives in the relevant `@pinagent/ee-*` package; the **Postgres adapter**
(`createPg*`) lives in [`src/db/`](src/db) over the shared Drizzle client, and
gets a PGlite-backed adapter test. Operators are imported from `@pinagent/db`,
never `drizzle-orm` directly (single-instance dedupe).

### Identity model

`User.id` is an **opaque synthetic id** (`usr_<uuid>`), *not* the IdP subject.
The mapping `(connectionId, subject) → userId` lives in `auth.sso_identities`,
resolved by `UserStore.provisionFromProfile` at login — so a tenant can change
IdP or rotate a subject without orphaning memberships. Tokens, memberships, and
audit `actorUserId` all key on the synthetic id. (See `@pinagent/ee-auth`.)

### Session-issuance enforcement order

`/sessions` ([`src/session-service.ts`](src/session-service.ts)) gates a grant
in order, each layer opt-in via its dep:

1. **membership + RBAC** — `issueRelaySessionToken` → 403 if not an active member.
2. **plan quota** — `ee-billing` `checkQuota` → 402 over the plan's included usage.
3. **cost control** — `ee-team-features` `evaluateCostControl` → 402 block / warn.
4. **audit + meter** — record the grant + a billable relay-session unit.

### Database

One Neon/Postgres database, four per-domain schemas: **`auth`** (orgs,
memberships, users, sso_identities, sso_connections + credentials), **`team`**
(audit_events, cost_controls, branch_routing), **`billing`** (usage_events,
subscriptions), **`relay`** (active_sessions). Schema is
[`src/db/schema.ts`](src/db/schema.ts); migrations are version-controlled in
[`drizzle/`](drizzle) (additive; text columns over pg enums so new
actions/states need no migration).

```bash
pnpm --filter @pinagent/cloud drizzle:gen     # generate a migration after a schema edit (offline)
pnpm --filter @pinagent/cloud drizzle:check   # lint the generated files (offline)

# Apply pending migrations. The Worker does NOT migrate on boot, so this is the
# only thing that advances the schema. Needs DATABASE_URL — run via Doppler so
# the value matches the target environment:
doppler run --config dev -- pnpm --filter @pinagent/cloud drizzle:migrate   # dev DB
doppler run --config prd -- pnpm --filter @pinagent/cloud drizzle:migrate   # production
```

### Billing rollover + the Stripe seam

A daily Cron Trigger (`wrangler.toml`) fires the Worker's `scheduled()` handler
→ `runBillingRollover`, which advances every subscription whose period has
elapsed (resetting usage windows). Reporting to an external provider goes
through the `BillingReporter` port — currently `noopBillingReporter`; a
`createStripeReporter` (needs Stripe API keys) drops into that seam.

## Configuration

Read once at boot in [`src/config.ts`](src/config.ts); a missing required value
fails the deploy rather than the first request. The complete key list — the
required/optional split and which are secrets — is the contract in
[`.dev.vars.example`](.dev.vars.example) (kept in sync with `config.ts` by
`pnpm lint:env-example`).

**Values live in Doppler**, the org source of truth (project `pinagent`,
configs `dev` + `prd`) — never committed here. The two planes:

```bash
# Local — wrangler dev reads .dev.vars (NOT process.env), so generate it:
doppler secrets download --no-file --format env --config dev > .dev.vars

# Production — sync the prd config into the Worker secret store:
doppler secrets download --no-file --format env --config prd \
  | wrangler secret bulk --name pinagent-cloud
```

The handful of non-secret config vars (`PINAGENT_RELAY_PUBLIC_URL`, the `OIDC_*`
ids/urls, `LOGIN_RETURN_TO`, `SESSION_*`) flow through the same path — keeping a
single source of truth rather than splitting them into a committed `[vars]`
block.

## Develop / deploy / test

```bash
pnpm --filter @pinagent/cloud dev:worker   # wrangler dev (local Worker, :8787)
pnpm --filter @pinagent/cloud deploy       # wrangler deploy
pnpm --filter @pinagent/cloud typecheck
pnpm exec vitest run apps/cloud            # services (in-memory) + PGlite adapter tests
```

Tests resolve `@pinagent/*` to built `dist/`, so build the `ee-*` packages
first (a plain `pnpm build` does the whole workspace). The dashboard talks to
this Worker via a same-origin proxy — point it here with
`CLOUD_API_ORIGIN=http://127.0.0.1:8787`.
