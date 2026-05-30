// SPDX-License-Identifier: Elastic-2.0
import { NotImplementedError } from './errors';
import type { OrganizationId, UserId } from './membership';
import type { Role } from './rbac';

/**
 * A pending invitation to join an organization, keyed by email — the
 * pre-login state that bridges "an admin invited this address" and "a member
 * row exists". Memberships key on the synthetic {@link UserId}, which only
 * exists after the invitee's first SSO login; until then the invitation holds
 * the intended `role`. The SSO callback consumes a matching invitation
 * (org + email) into an active membership and deletes it.
 */
export interface Invitation {
  organizationId: OrganizationId;
  /** Invitee email — always stored normalized (see {@link normalizeEmail}). */
  email: string;
  /** Role the invitee gets when they join. */
  role: Role;
  /** ISO-8601 timestamp the invite was issued. */
  invitedAt: string;
  /** The admin who issued it (a {@link UserId}), or `null` if unknown. */
  invitedByUserId: UserId | null;
}

/** Normalize an email for storage + matching: trimmed, lowercased. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Persistence boundary for pending invitations. Keyed by `(organizationId,
 * email)` — re-inviting an address overwrites the prior pending role.
 */
export interface InvitationStore {
  upsert(invitation: Invitation): Promise<void>;
  listByOrg(organizationId: OrganizationId): Promise<Invitation[]>;
  get(organizationId: OrganizationId, email: string): Promise<Invitation | null>;
  remove(organizationId: OrganizationId, email: string): Promise<void>;
}

function key(organizationId: OrganizationId, email: string): string {
  // NUL separator — can't appear in either value, so the composite key is
  // unambiguous. Email is normalized first so lookups are case-insensitive.
  return `${organizationId} ${normalizeEmail(email)}`;
}

/** In-memory {@link InvitationStore} for tests and single-process use. */
export function createInMemoryInvitationStore(seed: readonly Invitation[] = []): InvitationStore {
  const byKey = new Map<string, Invitation>(
    seed.map((i) => [key(i.organizationId, i.email), { ...i, email: normalizeEmail(i.email) }]),
  );
  return {
    async upsert(invitation) {
      byKey.set(key(invitation.organizationId, invitation.email), {
        ...invitation,
        email: normalizeEmail(invitation.email),
      });
    },
    async listByOrg(organizationId) {
      return [...byKey.values()].filter((i) => i.organizationId === organizationId);
    },
    async get(organizationId, email) {
      return byKey.get(key(organizationId, email)) ?? null;
    },
    async remove(organizationId, email) {
      byKey.delete(key(organizationId, email));
    },
  };
}

/**
 * Placeholder store so the cloud app can satisfy its DI graph before the real
 * adapter lands. Every method throws {@link NotImplementedError}.
 */
export const unimplementedInvitationStore: InvitationStore = {
  upsert() {
    throw new NotImplementedError('InvitationStore.upsert');
  },
  listByOrg() {
    throw new NotImplementedError('InvitationStore.listByOrg');
  },
  get() {
    throw new NotImplementedError('InvitationStore.get');
  },
  remove() {
    throw new NotImplementedError('InvitationStore.remove');
  },
};
