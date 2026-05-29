// SPDX-License-Identifier: Elastic-2.0
import { isRole, type Role } from './rbac';
import { type CodecFailure, nowSeconds, signClaims, verifyClaims } from './token-codec';

/**
 * Signed session tokens for the cloud relay.
 *
 * A session token authorizes one WebSocket connection to one tenant
 * session on `@pinagent/ee-relay`. Both sides of a relay session — the
 * dev machine's agent-runner (device) and the browser/dock clients —
 * present a token scoped to the *same* `sessionId`, which is how they
 * land on the same Durable Object. Built on the shared {@link token-codec}.
 */

export interface SessionClaims {
  /** Billing/RBAC tenant the session belongs to (an organization id). */
  tenantId: string;
  /** Relay session id — namespaces the Durable Object. */
  sessionId: string;
  /**
   * The member's role within the tenant, carried in the token so the relay
   * can apply RBAC per connection without a round-trip to the membership
   * store. Issued by {@link issueRelaySessionToken}.
   */
  role: Role;
  /** Issued-at, epoch seconds. */
  iat: number;
  /** Expiry, epoch seconds. */
  exp: number;
}

export interface SignOptions {
  /** Token lifetime in seconds (default 1 hour). */
  ttlSeconds?: number;
  /** Override the issued-at clock (epoch seconds) — for tests. */
  nowSeconds?: number;
}

export type VerifyResult =
  | { ok: true; claims: SessionClaims }
  | { ok: false; reason: CodecFailure };

const DEFAULT_TTL_SECONDS = 3_600;

/**
 * Mint a signed token for `{ tenantId, sessionId, role }`. Prefer
 * {@link issueRelaySessionToken}, which derives these from a verified
 * organization membership; call this directly only when the claims are
 * already trusted.
 */
export async function signSessionToken(
  input: { tenantId: string; sessionId: string; role: Role },
  secret: string,
  opts: SignOptions = {},
): Promise<string> {
  const now = opts.nowSeconds ?? nowSeconds();
  const claims: SessionClaims = {
    tenantId: input.tenantId,
    sessionId: input.sessionId,
    role: input.role,
    iat: now,
    exp: now + (opts.ttlSeconds ?? DEFAULT_TTL_SECONDS),
  };
  return signClaims(claims, secret);
}

/**
 * Verify a token's signature and expiry. Returns the decoded claims on
 * success, or a typed reason on failure (so the caller can log *why* a
 * connection was rejected without leaking it to the client).
 */
export function verifySessionToken(
  token: string,
  secret: string,
  opts: { nowSeconds?: number } = {},
): Promise<VerifyResult> {
  return verifyClaims(token, secret, isSessionClaims, opts);
}

function isSessionClaims(value: unknown): value is SessionClaims {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.tenantId === 'string' &&
    typeof c.sessionId === 'string' &&
    isRole(c.role) &&
    typeof c.iat === 'number' &&
    typeof c.exp === 'number'
  );
}
