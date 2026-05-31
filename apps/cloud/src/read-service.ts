// SPDX-License-Identifier: Elastic-2.0
import {
  AccessDeniedError,
  authorizeOrgMember,
  MembershipRequiredError,
  type MembershipStore,
  type OrganizationMembership,
  type Permission,
  type UserStore,
} from '@pinagent/ee-auth';
import type { MeterSink } from '@pinagent/ee-billing';
import type { AuditSink } from '@pinagent/ee-team-features';
import type { Authenticator } from './session-service';

/**
 * Admin read endpoints — the read side of the control plane, exposing the
 * data the write path collects. All are org-scoped (`?organizationId=`) and
 * RBAC-gated against the caller's membership:
 *
 *   GET /usage    → billing:read   → metered usage summary
 *   GET /audit    → org:settings   → recent audit events
 *   GET /members  → org:settings   → organization members
 *   GET /me/orgs  → authenticated  → the caller's own organizations
 *
 * Framework-agnostic (Web `Request`/`Response`), fully injected for testing.
 */
export interface ReadServiceDeps {
  store: MembershipStore;
  /** Resolves a membership's `userId` to the user record for `/members`. */
  users: UserStore;
  authenticate: Authenticator;
  audit: AuditSink;
  meter: MeterSink;
}

/** A membership enriched with the user's email + display name for the UI. */
export interface EnrichedMember extends OrganizationMembership {
  email: string | null;
  displayName: string | null;
}

const MAX_AUDIT_LIMIT = 500;
const DEFAULT_AUDIT_LIMIT = 100;

/** GET /usage — metered usage summary for an org. */
export async function handleUsage(request: Request, deps: ReadServiceDeps): Promise<Response> {
  const ctx = await openOrgRead(request, deps, 'billing:read');
  if (ctx.denied) return ctx.denied;
  const usage = await deps.meter.summarize({ organizationId: ctx.organizationId });
  return json({ organizationId: ctx.organizationId, usage }, 200);
}

/** GET /audit — recent audit events for an org (newest first). */
export async function handleAudit(request: Request, deps: ReadServiceDeps): Promise<Response> {
  const ctx = await openOrgRead(request, deps, 'org:settings');
  if (ctx.denied) return ctx.denied;
  const limit = parseLimit(new URL(request.url).searchParams.get('limit'));
  const events = await deps.audit.list({ organizationId: ctx.organizationId, limit });
  return json({ organizationId: ctx.organizationId, events }, 200);
}

/**
 * GET /members — the organization's members, each enriched with the user's
 * email + display name (resolved from the synthetic `userId`) so the UI can
 * show a human label instead of an opaque id. `email`/`displayName` are `null`
 * when no user record backs the membership.
 */
export async function handleMembers(request: Request, deps: ReadServiceDeps): Promise<Response> {
  const ctx = await openOrgRead(request, deps, 'org:settings');
  if (ctx.denied) return ctx.denied;
  const memberships = await deps.store.listMembers(ctx.organizationId);
  const members: EnrichedMember[] = await Promise.all(
    memberships.map(async (m) => {
      const user = await deps.users.get(m.userId);
      return { ...m, email: user?.email ?? null, displayName: user?.displayName ?? null };
    }),
  );
  return json({ organizationId: ctx.organizationId, members }, 200);
}

/** One of the caller's organizations, enriched for the dashboard org switcher. */
export interface MyOrg {
  organizationId: string;
  /** Human label; falls back to the id when the org row is missing. */
  displayName: string;
  slug: string | null;
  role: OrganizationMembership['role'];
  status: OrganizationMembership['status'];
}

/**
 * GET /me/orgs — the organizations the authenticated caller belongs to. Unlike
 * the other read endpoints this is NOT org-scoped or RBAC-gated: a caller may
 * always list their own memberships. Each is enriched with the org's display
 * name + slug so the dashboard can render a switcher without an extra round
 * trip.
 */
export async function handleMyOrgs(request: Request, deps: ReadServiceDeps): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405);
  const user = await deps.authenticate(request);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const memberships = await deps.store.listMembershipsByUser(user.userId);
  const orgs: MyOrg[] = await Promise.all(
    memberships.map(async (m) => {
      const org = await deps.store.getOrganization(m.organizationId);
      return {
        organizationId: m.organizationId,
        displayName: org?.displayName ?? m.organizationId,
        slug: org?.slug ?? null,
        role: m.role,
        status: m.status,
      };
    }),
  );
  return json({ orgs }, 200);
}

type ReadContext =
  | { denied: Response; organizationId?: undefined }
  | { denied: null; organizationId: string };

/**
 * Shared preamble for the read endpoints: GET-only, an `organizationId` query
 * param, an authenticated caller, and an active membership holding
 * `permission`. Returns either a denial `Response` or the resolved org.
 */
async function openOrgRead(
  request: Request,
  deps: ReadServiceDeps,
  permission: Permission,
): Promise<ReadContext> {
  if (request.method !== 'GET') return { denied: json({ error: 'method not allowed' }, 405) };

  const organizationId = new URL(request.url).searchParams.get('organizationId');
  if (!organizationId) return { denied: json({ error: 'organizationId is required' }, 400) };

  const user = await deps.authenticate(request);
  if (!user) return { denied: json({ error: 'unauthorized' }, 401) };

  try {
    await authorizeOrgMember(deps.store, user.userId, organizationId, permission);
  } catch (err) {
    // Collapse both "not a member" and "insufficient role" to 403 so we don't
    // leak whether the org exists / who belongs to it.
    if (err instanceof MembershipRequiredError || err instanceof AccessDeniedError) {
      return { denied: json({ error: 'forbidden' }, 403) };
    }
    throw err;
  }
  return { denied: null, organizationId };
}

function parseLimit(raw: string | null): number {
  const n = raw === null ? DEFAULT_AUDIT_LIMIT : Number(raw);
  if (!Number.isInteger(n) || n <= 0) return DEFAULT_AUDIT_LIMIT;
  return Math.min(n, MAX_AUDIT_LIMIT);
}

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
