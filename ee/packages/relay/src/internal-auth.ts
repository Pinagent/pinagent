// SPDX-License-Identifier: Elastic-2.0
/**
 * Shared-secret auth for service-to-service calls INTO the relay (the
 * control plane pushing frames down to a connected device). Mirrors the
 * receiving half on the control plane (`apps/cloud` internal-service): a
 * `Authorization: Bearer <RELAY_INTERNAL_SECRET>` header, compared in
 * constant time. Kept in the runtime-agnostic core so it's unit-testable
 * without the Workers runtime.
 */

/** Extract the token from an `Authorization: Bearer <token>` header. */
export function bearer(header: string | null): string | null {
  if (!header) return null;
  const token = /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim();
  return token ? token : null;
}

/** Length-aware constant-time string compare for the shared secret. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Whether an inbound internal request is authorized. Fails closed when no
 * secret is configured (production must set `RELAY_INTERNAL_SECRET`; an unset
 * secret disables the push endpoint rather than accepting anyone).
 */
export function isAuthorizedInternal(
  authHeader: string | null,
  secret: string | undefined,
): boolean {
  if (!secret) return false;
  const provided = bearer(authHeader);
  if (!provided) return false;
  return timingSafeEqual(provided, secret);
}
