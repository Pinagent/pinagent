// SPDX-License-Identifier: Elastic-2.0
import {
  AccessDeniedError,
  authorizeOrgMember,
  type Invitation,
  type InvitationStore,
  isRole,
  MembershipRequiredError,
  type MembershipStore,
  normalizeEmail,
  type Permission,
  type Role,
  type UserStore,
} from '@pinagent/ee-auth';
import { AUDIT_ACTIONS, type AuditSink } from '@pinagent/ee-team-features';
import type { Authenticator } from './session-service';

/**
 * Member-management endpoints — growing a team. Today: invitations.
 *
 *   POST   /invitations  → member:invite  → invite an email (+ role)
 *   GET    /invitations  → org:settings   → list pending invitations
 *   DELETE /invitations  → member:remove  → revoke a pending invitation
 *
 * An invite either grants a membership immediately (when the email already
 * maps to exactly one user) or stages a pending {@link Invitation} that the
 * SSO callback consumes on the invitee's next login (see `login-service`).
 * Org-scoped (`?organizationId=`), RBAC-gated, fully injected for testing.
 */
export interface MemberServiceDeps {
  store: MembershipStore;
  users: UserStore;
  invitations: InvitationStore;
  authenticate: Authenticator;
  audit?: AuditSink;
  /** ISO-8601 clock — injected for deterministic tests. */
  now?: () => string;
}

/** GET/POST/DELETE /invitations. */
export async function handleInvitations(
  request: Request,
  deps: MemberServiceDeps,
): Promise<Response> {
  if (request.method === 'GET') {
    const ctx = await authorize(request, deps, 'org:settings');
    if ('denied' in ctx) return ctx.denied;
    const invitations = await deps.invitations.listByOrg(ctx.organizationId);
    return json({ organizationId: ctx.organizationId, invitations }, 200);
  }

  if (request.method === 'POST') {
    const ctx = await authorize(request, deps, 'member:invite');
    if ('denied' in ctx) return ctx.denied;
    const body = await readJson(request);
    if (body === undefined) return json({ error: 'invalid JSON body' }, 400);
    const parsed = parseInviteBody(body);
    if (!parsed) return json({ error: 'email and a valid role are required' }, 400);

    const now = (deps.now ?? defaultNow)();
    const email = normalizeEmail(parsed.email);

    // Immediate grant only when the email maps to exactly one existing user;
    // otherwise (absent or ambiguous) stage a pending invitation.
    const matches = await deps.users.findByEmail(email);
    if (matches.length === 1) {
      const user = matches[0];
      if (!user) return json({ error: 'internal error' }, 500); // unreachable; narrows the type
      const membership = {
        organizationId: ctx.organizationId,
        userId: user.id,
        role: parsed.role,
        status: 'active' as const,
        invitedAt: now,
        joinedAt: now,
      };
      await deps.store.upsertMembership(membership);
      await recordInvite(deps, ctx, email, now);
      return json({ organizationId: ctx.organizationId, membership }, 200);
    }

    const invitation: Invitation = {
      organizationId: ctx.organizationId,
      email,
      role: parsed.role,
      invitedAt: now,
      invitedByUserId: ctx.actorUserId,
    };
    await deps.invitations.upsert(invitation);
    await recordInvite(deps, ctx, email, now);
    return json({ organizationId: ctx.organizationId, invitation }, 200);
  }

  if (request.method === 'DELETE') {
    const ctx = await authorize(request, deps, 'member:remove');
    if ('denied' in ctx) return ctx.denied;
    const email = new URL(request.url).searchParams.get('email');
    if (!email) return json({ error: 'email is required' }, 400);
    await deps.invitations.remove(ctx.organizationId, email);
    return json({ organizationId: ctx.organizationId, email: normalizeEmail(email) }, 200);
  }

  return json({ error: 'method not allowed' }, 405);
}

function recordInvite(
  deps: MemberServiceDeps,
  ctx: { organizationId: string; actorUserId: string },
  email: string,
  now: string,
): Promise<void> | undefined {
  return deps.audit?.record({
    occurredAt: now,
    organizationId: ctx.organizationId,
    actorUserId: ctx.actorUserId,
    action: AUDIT_ACTIONS.memberInvited,
    metadata: { email },
  });
}

type AuthorizeResult = { denied: Response } | { organizationId: string; actorUserId: string };

async function authorize(
  request: Request,
  deps: MemberServiceDeps,
  permission: Permission,
): Promise<AuthorizeResult> {
  const organizationId = new URL(request.url).searchParams.get('organizationId');
  if (!organizationId) return { denied: json({ error: 'organizationId is required' }, 400) };
  const user = await deps.authenticate(request);
  if (!user) return { denied: json({ error: 'unauthorized' }, 401) };
  try {
    await authorizeOrgMember(deps.store, user.userId, organizationId, permission);
  } catch (err) {
    if (err instanceof MembershipRequiredError || err instanceof AccessDeniedError) {
      return { denied: json({ error: 'forbidden' }, 403) };
    }
    throw err;
  }
  return { organizationId, actorUserId: user.userId };
}

function parseInviteBody(value: unknown): { email: string; role: Role } | null {
  if (typeof value !== 'object' || value === null) return null;
  const { email, role } = value as Record<string, unknown>;
  if (typeof email !== 'string' || !email.includes('@') || email.trim().length === 0) return null;
  if (!isRole(role)) return null;
  return { email, role };
}

function defaultNow(): string {
  return new Date().toISOString();
}

/** Parse a JSON body; `undefined` signals malformed JSON. */
async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
