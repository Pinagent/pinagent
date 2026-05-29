// SPDX-License-Identifier: Elastic-2.0
import { verifyUserToken } from '@pinagent/ee-auth';
import type { Authenticator } from './session-service';

/**
 * Production {@link Authenticator}: validate a signed user-identity token
 * (`ee-auth` `verifyUserToken`) presented as a bearer token. This replaces
 * `devHeaderAuthenticator` — the login/SSO flow mints the token, every API
 * request carries it, and here we verify the signature + expiry and extract
 * the user id.
 *
 * `secret` is the same HMAC secret the login flow signs user tokens with
 * (distinct from the relay's `RELAY_AUTH_SECRET`).
 */
export function createBearerAuthenticator(secret: string): Authenticator {
  return async (request) => {
    const token = bearer(request.headers.get('Authorization'));
    if (!token) return null;
    const result = await verifyUserToken(token, secret);
    return result.ok ? { userId: result.claims.userId } : null;
  };
}

function bearer(header: string | null): string | null {
  if (!header) return null;
  const token = /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim();
  return token ? token : null;
}
