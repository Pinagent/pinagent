# @pinagent/ee-auth

SSO, RBAC, and organization membership for Pinagent cloud.

Licensed under the [Elastic License v2](../../LICENSE) — source-available, not
open source. See [`ee/README.md`](../../README.md) for the boundary.

## Status

This phase defines the **public type surface** and a working, dependency-free
**RBAC engine**. Network/persistence boundaries are expressed as interfaces
with `unimplemented*` placeholders so the cloud app can wire its dependency
graph before the real adapters land — each placeholder throws
`NotImplementedError` the moment it is exercised.

## Surface

| Module          | Exports                                                                 |
| --------------- | ----------------------------------------------------------------------- |
| `rbac.ts`       | `ROLES`, `PERMISSIONS`, `can`, `assertCan`, `permissionsForRole`, `compareRoles`, `isRole`, `isPermission` |
| `membership.ts` | `Organization`, `OrganizationMembership`, `MembershipStatus`, `MembershipStore`, `isActiveMember`, `unimplementedMembershipStore` |
| `user.ts`       | `User`, `SsoIdentity`, `UserStore`, `userFromProfile`, `defaultUserId`, `createInMemoryUserStore` |
| `sso.ts`        | `SsoProtocol`, `SsoConnection`, `SsoProfile`, `SsoCallback`, `SsoProvider`, `isSsoProtocol`, `unimplementedSsoProvider` |
| `principal.ts`  | `Principal`, `principalCan`                                             |
| `errors.ts`     | `AuthError`, `NotImplementedError`, `AccessDeniedError`                 |

## RBAC model

Roles are hierarchical and ordered from least to most privileged:

```
viewer → member → admin → owner
```

Each role inherits every permission held by the roles beneath it. The
role→permission matrix in `rbac.ts` is the single source of truth; resolve
authorization through `can(role, permission)` rather than checking roles
directly at call sites.

```ts
import { can, assertCan, principalCan } from '@pinagent/ee-auth';

can('member', 'project:read'); // true (inherited from viewer)
can('member', 'member:invite'); // false (admin-only)

assertCan(principal.role, 'org:delete'); // throws AccessDeniedError unless owner
```

## Identity model

A `User` has an **opaque synthetic `id`** (`usr_<uuid>`), minted once on first
login — it is deliberately *not* the IdP subject. The mapping from an external
IdP identity to the internal user is an `SsoIdentity { connectionId, subject,
userId }`, keyed on `(connectionId, subject)`. `UserStore.provisionFromProfile`
owns this resolution: it returns the existing user for a known identity, or
mints a synthetic id and records the mapping on first login.

Everything downstream — the user token's `userId`, `organization_membership`
rows, and audit `actorUserId` — keys on the synthetic id, so a tenant can
change IdP or rotate a subject without orphaning memberships. The Postgres
adapter persists the mapping in the `auth.sso_identities` table (one user may
hold several identities across connections).

## Next steps

- Implement `SsoProvider` for SAML (OIDC is wired in `apps/cloud`), mapping IdP
  group claims to roles.
