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

## Next steps

- Back `MembershipStore` with the relay's Postgres adapter.
- Implement `SsoProvider` for SAML and OIDC, mapping IdP group claims to roles.
