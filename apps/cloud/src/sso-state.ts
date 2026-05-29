// SPDX-License-Identifier: Elastic-2.0
import { nowSeconds, signClaims, type VerifyOutcome, verifyClaims } from '@pinagent/ee-auth';

/**
 * The OIDC `state` we hand to the IdP and get back on the callback — signed
 * (via the shared token codec) so it's stateless yet CSRF-safe: an attacker
 * can't forge a `state` that passes verification, so a callback only succeeds
 * for a login *we* started. Also carries the post-login `returnTo` and the
 * connection it was started for.
 */
export interface LoginState {
  connectionId: string;
  returnTo: string;
  iat: number;
  exp: number;
}

const DEFAULT_TTL_SECONDS = 600; // a login round-trip is short-lived

export function signLoginState(
  input: { connectionId: string; returnTo: string },
  secret: string,
  opts: { ttlSeconds?: number; nowSeconds?: number } = {},
): Promise<string> {
  const now = opts.nowSeconds ?? nowSeconds();
  const claims: LoginState = {
    connectionId: input.connectionId,
    returnTo: input.returnTo,
    iat: now,
    exp: now + (opts.ttlSeconds ?? DEFAULT_TTL_SECONDS),
  };
  return signClaims(claims, secret);
}

export function verifyLoginState(
  token: string,
  secret: string,
  opts: { nowSeconds?: number } = {},
): Promise<VerifyOutcome<LoginState>> {
  return verifyClaims(token, secret, isLoginState, opts);
}

function isLoginState(value: unknown): value is LoginState {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.connectionId === 'string' &&
    typeof c.returnTo === 'string' &&
    typeof c.iat === 'number' &&
    typeof c.exp === 'number'
  );
}
