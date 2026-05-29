# Pinagent Enterprise

The code in this directory is licensed under the [Elastic License v2](./LICENSE).

It is source-available but **not** open source under the OSI definition. You may
read, modify, and run this code for your own internal use. You may not provide
it as a managed service to third parties.

The rest of the Pinagent repository (everything outside this directory and
`apps/cloud/`) is licensed under the [Apache License 2.0](../LICENSE).

We do not accept external pull requests against this directory. See
[CONTRIBUTING.md](../CONTRIBUTING.md) for the boundary and rationale.

## Packages

| Package | Purpose |
|---|---|
| `@pinagent/ee-relay` | Hosted multi-tenant relay between developer machines and the cloud agent runtime. |
| `@pinagent/ee-auth` | SSO, RBAC, organization membership. |
| `@pinagent/ee-billing` | Stripe integration, plan limits, metering. |
| `@pinagent/ee-team-features` | Audit log, branch routing, cost controls. |
| `@pinagent/ee-infra` | Cloud-specific orchestration (deploy, observability glue). |

`@pinagent/ee-auth` has its first phase in place — a public type surface and a
working RBAC engine, with persistence and SSO boundaries scaffolded as
interfaces. See [`packages/auth/README.md`](./packages/auth/README.md). The
remaining packages are stubs at this point — see `packages/<name>/src/index.ts`.
