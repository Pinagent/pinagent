// SPDX-License-Identifier: Elastic-2.0
import type { UserId } from './membership';
import { type CodecFailure, nowSeconds, signClaims, verifyClaims } from './token-codec';

/**
 * Signed user-identity tokens — the credential a logged-in user presents to
 * the cloud control plane (e.g. on `POST /sessions`).
 *
 * Distinct from a relay {@link SessionClaims} token: this asserts *who the
 * caller is*, not which relay session/org they're connecting to. A user may
 * belong to several organizations, so this token is org-agnostic — the
 * organization + role binding happens later, when a relay session token is
 * issued for a specific org. Minted by the SSO/login flow after an identity
 * provider authenticates the user; validated on every API request.
 *
 * Built on the shared {@link token-codec}.
 */

export interface UserClaims {
  /** The authenticated user's stable id. */
  userId: UserId;
  /** Issued-at, epoch seconds. */
  iat: number;
  /** Expiry, epoch seconds. */
  exp: number;
}

export interface SignUserTokenOptions {
  /** Token lifetime in seconds (default 1 hour). */
  ttlSeconds?: number;
  /** Override the issued-at clock (epoch seconds) — for tests. */
  nowSeconds?: number;
}

export type VerifyUserResult =
  | { ok: true; claims: UserClaims }
  | { ok: false; reason: CodecFailure };

const DEFAULT_TTL_SECONDS = 3_600;

/** Mint a user-identity token after a successful login/SSO handshake. */
export async function signUserToken(
  userId: UserId,
  secret: string,
  opts: SignUserTokenOptions = {},
): Promise<string> {
  const now = opts.nowSeconds ?? nowSeconds();
  const claims: UserClaims = {
    userId,
    iat: now,
    exp: now + (opts.ttlSeconds ?? DEFAULT_TTL_SECONDS),
  };
  return signClaims(claims, secret);
}

/** Verify a user-identity token's signature and expiry. */
export function verifyUserToken(
  token: string,
  secret: string,
  opts: { nowSeconds?: number } = {},
): Promise<VerifyUserResult> {
  return verifyClaims(token, secret, isUserClaims, opts);
}

function isUserClaims(value: unknown): value is UserClaims {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.userId === 'string' &&
    c.userId.length > 0 &&
    typeof c.iat === 'number' &&
    typeof c.exp === 'number'
  );
}
