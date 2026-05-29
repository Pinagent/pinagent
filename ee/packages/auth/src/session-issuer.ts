// SPDX-License-Identifier: Elastic-2.0
import { MembershipRequiredError } from './errors';
import {
  isActiveMember,
  type MembershipStore,
  type OrganizationId,
  type UserId,
} from './membership';
import type { Principal } from './principal';
import { assertCan, type Permission } from './rbac';
import { signSessionToken } from './session-token';

/**
 * Relay session-token issuance — the bridge between identity (who you are,
 * what org you belong to, what role you hold) and the relay's connection
 * credential.
 *
 * The relay verifies tokens but never decides who *gets* one; that decision
 * lives here, where it has access to the membership store. The organization
 * becomes the token's tenant and the member's role rides along in the claims,
 * so the relay can apply RBAC per connection without calling back into the
 * store on every socket.
 */

export interface IssueRelaySessionOptions {
  /** Membership source of truth — checks the user belongs to the org. */
  store: MembershipStore;
  userId: UserId;
  organizationId: OrganizationId;
  /**
   * Relay session id namespacing the Durable Object both sides connect to.
   * The device (agent-runner) and its clients must be issued tokens with the
   * same `sessionId` to land on the same DO.
   */
  sessionId: string;
  /** HMAC secret shared with the relay (its `RELAY_AUTH_SECRET`). */
  secret: string;
  /** Token lifetime in seconds (defaults to the signer's default). */
  ttlSeconds?: number;
  /**
   * Optional capability gate beyond active membership. When set, the member's
   * role must hold this permission or issuance throws `AccessDeniedError`.
   * Active membership alone is otherwise sufficient (every role can read).
   */
  requirePermission?: Permission;
  /** Override the issued-at clock (epoch seconds) — for tests. */
  nowSeconds?: number;
}

export interface IssuedRelaySession {
  token: string;
  /** The resolved actor, handy for audit logging at the call site. */
  principal: Principal;
}

/**
 * Mint a relay session token for an authenticated user after verifying they
 * are an *active* member of the organization.
 *
 * @throws {MembershipRequiredError} when the user has no active membership.
 * @throws {AccessDeniedError} when `requirePermission` is set and the member's
 *   role doesn't hold it.
 */
export async function issueRelaySessionToken(
  opts: IssueRelaySessionOptions,
): Promise<IssuedRelaySession> {
  const membership = await opts.store.getMembership(opts.organizationId, opts.userId);
  if (!membership || !isActiveMember(membership)) {
    throw new MembershipRequiredError(opts.organizationId, opts.userId);
  }

  const principal: Principal = {
    userId: opts.userId,
    organizationId: opts.organizationId,
    role: membership.role,
  };

  if (opts.requirePermission) {
    assertCan(principal.role, opts.requirePermission);
  }

  const token = await signSessionToken(
    { tenantId: opts.organizationId, sessionId: opts.sessionId, role: membership.role },
    opts.secret,
    { ttlSeconds: opts.ttlSeconds, nowSeconds: opts.nowSeconds },
  );

  return { token, principal };
}
