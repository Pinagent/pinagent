// SPDX-License-Identifier: Elastic-2.0
import { RelaySession } from './relay-do';

/**
 * Cloudflare Worker bindings. `RELAY` is the Durable Object namespace
 * declared in `wrangler.toml`; `RELAY_AUTH_SECRET` is reserved for the
 * `ee-auth` token-verification seam below.
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

    const auth = verifyToken(request, url, env);
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
 * TODO(ee-auth): replace with real verification — validate a signed
 * session token (SSO / JWT issued by `@pinagent/ee-auth`) using
 * `env.RELAY_AUTH_SECRET`, and derive `tenantId` from its claims rather
 * than trusting the `session` query param. For now this is a placeholder
 * that accepts any non-empty token and namespaces the Durable Object by
 * the caller-supplied session id, so the transport can be exercised
 * end-to-end before auth lands.
 */
function verifyToken(request: Request, url: URL, _env: Env): RelayAuth | null {
  const token =
    request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ??
    url.searchParams.get('token') ??
    '';
  const sessionId = url.searchParams.get('session') ?? '';
  if (!token || !sessionId) return null;
  return { tenantId: sessionId, sessionId };
}

export { RelaySession };
