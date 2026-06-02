// SPDX-License-Identifier: Elastic-2.0
/**
 * Durable Object name for a relay session.
 *
 * The DO is keyed by BOTH the tenant and the session, never the session
 * alone. `sessionId` is caller-chosen and predictable (the agent-runner
 * derives it as a hash of the project path), so keying on it alone would let
 * a member of org B request a token for org A's `sessionId` and land on org
 * A's Durable Object — reading its device frames and driving its agent. With
 * the tenant folded into the name, that same request resolves to a *different*
 * DO (one carrying org B's tenantId), so cross-tenant collision is impossible.
 *
 * The NUL separator can't appear in either id (both are opaque ids minted
 * upstream), so the encoding is unambiguous: `(a, b<NUL>c)` and `(a<NUL>b, c)`
 * can't alias. Mirrors the composite-key convention in `apps/cloud`'s
 * active-session store.
 */
const SEPARATOR = String.fromCharCode(0);

export function relayDoName(tenantId: string, sessionId: string): string {
  return `${tenantId}${SEPARATOR}${sessionId}`;
}
