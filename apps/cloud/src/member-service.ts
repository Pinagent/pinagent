// SPDX-License-Identifier: Elastic-2.0
import {
  AccessDeniedError,
  authorizeOrgMember,
  can,
  type Invitation,
  type InvitationStore,
  isActiveMember,
  isRole,
  MembershipRequiredError,
  type MembershipStore,
  normalizeEmail,
  type OrganizationId,
  type Permission,
  type Role,
  type UserStore,
} from '@pinagent/ee-auth';
import { AUDIT_ACTIONS, type AuditSink } from '@pinagent/ee-team-features';
import type { Authenticator } from './session-service';

/**
 * Member-management endpoints — growing + curating a team.
 *
 *   POST   /invitations  → member:invite  → invite an email (+ role; owner-gated)
 *   GET    /invitations  → org:settings   → list pending invitations
 *   DELETE /invitations  → member:remove  → revoke a pending invitation
 *   PATCH  /members?userId → member:invite → change a member's role
 *   DELETE /members?userId → member:remove → remove a member
 *
 * Owner is privileged: only an owner may grant/revoke the `owner` role or
 * remove an owner, and the last active owner can't be demoted or removed.
 *
 * An invite either grants a membership immediately (when the email already
 * maps to exactly one user) or stages a pending {@link Invitation} that the
 * SSO callback consumes on the invitee's next login (see `login-service`).
 * Org-scoped (`?organizationId=`), RBAC-gated, fully injected for testing.
 */
/**
 * Optional invite-notification port (satisfied by `@pinagent/ee-email`'s
 * `InvitationMailer`). Like {@link AuditSink} it's opt-in: absent in dev/tests
 * and when no email provider is configured, so invites work unchanged without it.
 */
export interface InvitationNotifier {
  sendInvitation(input: {
    to: string;
    organizationName: string;
    role: Role;
    inviterName: string | null;
  }): Promise<void>;
}

export interface MemberServiceDeps {
  store: MembershipStore;
  users: UserStore;
  invitations: InvitationStore;
  authenticate: Authenticator;
  audit?: AuditSink;
  /** Notifies the invitee by email (best-effort, opt-in). */
  email?: InvitationNotifier;
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

    // Granting the owner role — whether by an immediate membership or a staged
    // invitation consumed at login — is owner-only, mirroring the PATCH/DELETE
    // owner gates. Without this, a non-owner admin (who holds `member:invite`)
    // could mint owners and escalate past the owner/last-owner model.
    if (parsed.role === 'owner' && !can(ctx.actorRole, 'org:delete')) {
      return json({ error: 'only an owner can invite an owner' }, 403);
    }

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
      await notifyInvitee(deps, ctx, email, parsed.role);
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
    await notifyInvitee(deps, ctx, email, parsed.role);
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

/** DELETE/PATCH /members — remove a member or change their role. */
export async function handleMemberWrite(
  request: Request,
  deps: MemberServiceDeps,
): Promise<Response> {
  if (request.method === 'DELETE') return removeMember(request, deps);
  if (request.method === 'PATCH') return changeRole(request, deps);
  return json({ error: 'method not allowed' }, 405);
}

/** DELETE /members?userId — remove a member (member:remove; owner-gated). */
async function removeMember(request: Request, deps: MemberServiceDeps): Promise<Response> {
  const ctx = await authorize(request, deps, 'member:remove');
  if ('denied' in ctx) return ctx.denied;
  const userId = new URL(request.url).searchParams.get('userId');
  if (!userId) return json({ error: 'userId is required' }, 400);

  const target = await deps.store.getMembership(ctx.organizationId, userId);
  if (!target) return json({ error: 'member not found' }, 404);

  if (target.role === 'owner') {
    if (!can(ctx.actorRole, 'org:delete')) {
      return json({ error: 'only an owner can remove an owner' }, 403);
    }
    if (isActiveMember(target) && (await countActiveOwners(deps.store, ctx.organizationId)) <= 1) {
      return json({ error: 'cannot remove the last owner' }, 409);
    }
  }

  await deps.store.removeMembership(ctx.organizationId, userId);
  await deps.audit?.record({
    occurredAt: (deps.now ?? defaultNow)(),
    organizationId: ctx.organizationId,
    actorUserId: ctx.actorUserId,
    action: AUDIT_ACTIONS.memberRemoved,
    targetId: userId,
  });
  return json({ organizationId: ctx.organizationId, userId }, 200);
}

/** PATCH /members?userId — change a member's role (member:invite; owner-gated). */
async function changeRole(request: Request, deps: MemberServiceDeps): Promise<Response> {
  const ctx = await authorize(request, deps, 'member:invite');
  if ('denied' in ctx) return ctx.denied;
  const userId = new URL(request.url).searchParams.get('userId');
  if (!userId) return json({ error: 'userId is required' }, 400);
  const body = await readJson(request);
  if (body === undefined) return json({ error: 'invalid JSON body' }, 400);
  const role = parseRoleBody(body);
  if (!role) return json({ error: 'a valid role is required' }, 400);

  const target = await deps.store.getMembership(ctx.organizationId, userId);
  if (!target) return json({ error: 'member not found' }, 404);

  // Any change touching the owner role is owner-only.
  if ((role === 'owner' || target.role === 'owner') && !can(ctx.actorRole, 'org:delete')) {
    return json({ error: 'only an owner can grant or change the owner role' }, 403);
  }
  // Don't strand an org: the last active owner can't be demoted.
  if (
    target.role === 'owner' &&
    role !== 'owner' &&
    isActiveMember(target) &&
    (await countActiveOwners(deps.store, ctx.organizationId)) <= 1
  ) {
    return json({ error: 'cannot demote the last owner' }, 409);
  }

  const membership = { ...target, role };
  await deps.store.upsertMembership(membership);
  await deps.audit?.record({
    occurredAt: (deps.now ?? defaultNow)(),
    organizationId: ctx.organizationId,
    actorUserId: ctx.actorUserId,
    action: AUDIT_ACTIONS.memberRoleChanged,
    targetId: userId,
    metadata: { role },
  });
  return json({ organizationId: ctx.organizationId, membership }, 200);
}

/** Number of active members holding the `owner` role in an org. */
async function countActiveOwners(store: MembershipStore, org: OrganizationId): Promise<number> {
  const members = await store.listMembers(org);
  return members.filter((m) => m.role === 'owner' && isActiveMember(m)).length;
}

function parseRoleBody(value: unknown): Role | null {
  if (typeof value !== 'object' || value === null) return null;
  const { role } = value as Record<string, unknown>;
  return isRole(role) ? role : null;
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

/**
 * Best-effort invite email. Resolves the org + inviter display names (so the
 * email reads "Alice invited you to Acme" rather than raw ids) and hands them
 * to the notifier. Opt-in (`deps.email` absent → no-op) and fully swallowed:
 * the invite is already persisted, so a name lookup or send failure must never
 * turn a successful invite into an error.
 */
async function notifyInvitee(
  deps: MemberServiceDeps,
  ctx: { organizationId: string; actorUserId: string },
  to: string,
  role: Role,
): Promise<void> {
  if (!deps.email) return;
  try {
    const [org, inviter] = await Promise.all([
      deps.store.getOrganization(ctx.organizationId),
      deps.users.get(ctx.actorUserId),
    ]);
    await deps.email.sendInvitation({
      to,
      organizationName: org?.displayName ?? ctx.organizationId,
      role,
      inviterName: inviter?.displayName ?? inviter?.email ?? null,
    });
  } catch {
    // Best-effort: never fail the invite on a notification problem.
  }
}

type AuthorizeResult =
  | { denied: Response }
  | { organizationId: string; actorUserId: string; actorRole: Role };

async function authorize(
  request: Request,
  deps: MemberServiceDeps,
  permission: Permission,
): Promise<AuthorizeResult> {
  const organizationId = new URL(request.url).searchParams.get('organizationId');
  if (!organizationId) return { denied: json({ error: 'organizationId is required' }, 400) };
  const user = await deps.authenticate(request);
  if (!user) return { denied: json({ error: 'unauthorized' }, 401) };
  let actorRole: Role;
  try {
    const principal = await authorizeOrgMember(deps.store, user.userId, organizationId, permission);
    actorRole = principal.role;
  } catch (err) {
    if (err instanceof MembershipRequiredError || err instanceof AccessDeniedError) {
      return { denied: json({ error: 'forbidden' }, 403) };
    }
    throw err;
  }
  return { organizationId, actorUserId: user.userId, actorRole };
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
