// SPDX-License-Identifier: Elastic-2.0
import { verifyUserToken } from '@pinagent/ee-auth';
import type { Authenticator } from './session-service';

/**
 * Production {@link Authenticator}: validate a signed user-identity token
 * (`ee-auth` `verifyUserToken`) presented as an `Authorization: Bearer` token,
 * or — when `cookieName` is given — as a session cookie. The SSO callback sets
 * the cookie; SPA/API callers may instead send the bearer header. This
 * replaces `devHeaderAuthenticator`.
 *
 * `secret` is the same HMAC secret the login flow signs user tokens with
 * (distinct from the relay's `RELAY_AUTH_SECRET`).
 */
export function createBearerAuthenticator(
  secret: string,
  opts: { cookieName?: string } = {},
): Authenticator {
  return async (request) => {
    const token =
      bearer(request.headers.get('Authorization')) ??
      (opts.cookieName ? cookie(request.headers.get('Cookie'), opts.cookieName) : null);
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

function cookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim() || null;
  }
  return null;
}
