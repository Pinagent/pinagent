// SPDX-License-Identifier: Elastic-2.0
import { verifySessionToken } from '@pinagent/ee-auth';
import { RelaySession } from './relay-do';

/**
 * Cloudflare Worker bindings. `RELAY` is the Durable Object namespace
 * declared in `wrangler.toml`; `RELAY_AUTH_SECRET` is the HMAC secret
 * `ee-auth` signs session tokens with — when set, connections must
 * present a valid signed token.
 */
export interface Env {
  RELAY: DurableObjectNamespace;
  RELAY_AUTH_SECRET?: string;
}

interface RelayAuth {
  tenantId: string;
  sessionId: string;
}

const WS_PATH = '/__pinagent/ws';
const DEVICE_PATH = '/__pinagent/device';

/**
 * Edge router. Authenticates the connection, then hands the upgrade to
 * the per-session Durable Object.
 *
 *   - `GET /__pinagent/device?session=…`  ← agent-runner dials out
 *   - `GET /__pinagent/ws?session=…`      ← widget / hosted dock
 *
 * The agent-runner connecting *outbound* is what keeps the dev machine
 * reachable from the cloud without an inbound port.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname !== WS_PATH && url.pathname !== DEVICE_PATH) {
      return new Response('not found', { status: 404 });
    }
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected websocket upgrade', { status: 426 });
    }

    const auth = await verifyToken(request, url, env);
    if (!auth) return new Response('unauthorized', { status: 401 });

    const role = url.pathname === DEVICE_PATH ? 'device' : 'client';
    const id = env.RELAY.idFromName(auth.sessionId);
    const stub = env.RELAY.get(id);

    // Forward the upgrade to the session's Durable Object, tagging the
    // role so the DO knows which side of the relay this socket is.
    const forwarded = new Request(request, { headers: new Headers(request.headers) });
    forwarded.headers.set('X-Pinagent-Role', role);
    return stub.fetch(forwarded);
  },
};

/**
 * Verify the connection's bearer token and resolve it to a tenant +
 * session.
 *
 * When `RELAY_AUTH_SECRET` is set we require a valid `ee-auth` signed
 * session token: the token's claims are authoritative for both `tenantId`
 * and `sessionId` (the `?session=` query param is ignored — a client
 * can't talk its way onto another tenant's Durable Object by changing the
 * URL).
 *
 * When the secret is *unset* we fall back to dev mode: accept any
 * non-empty token and namespace the DO by the `?session=` query param.
 * This keeps local end-to-end testing frictionless; production deploys
 * must set the secret.
 */
async function verifyToken(request: Request, url: URL, env: Env): Promise<RelayAuth | null> {
  const token =
    request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ??
    url.searchParams.get('token') ??
    '';
  if (!token) return null;

  if (env.RELAY_AUTH_SECRET) {
    const result = await verifySessionToken(token, env.RELAY_AUTH_SECRET);
    if (!result.ok) return null;
    return { tenantId: result.claims.tenantId, sessionId: result.claims.sessionId };
  }

  // Dev fallback — NOT for production (no secret configured).
  const sessionId = url.searchParams.get('session') ?? '';
  if (!sessionId) return null;
  return { tenantId: sessionId, sessionId };
}

export { RelaySession };
