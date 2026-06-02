// SPDX-License-Identifier: Elastic-2.0
import { type Role, verifySessionToken } from '@pinagent/ee-auth';
import { relayDoName } from './do-name';
import { isAuthorizedInternal } from './internal-auth';
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
  /** Control-plane base URL the Durable Object reports lifecycle events to. */
  PINAGENT_CONTROL_PLANE_URL?: string;
  /** Shared secret presented to the control plane's relay-events ingest. */
  RELAY_INTERNAL_SECRET?: string;
}

interface RelayAuth {
  tenantId: string;
  sessionId: string;
  /**
   * The member's role, present when a signed token was verified. Carried for
   * forthcoming per-connection RBAC (e.g. gating `land_request` to writers);
   * absent in dev-fallback mode where no secret is configured.
   */
  role?: Role;
}

const WS_PATH = '/__pinagent/ws';
const DEVICE_PATH = '/__pinagent/device';
const INTERNAL_PUSH_PATH = '/__pinagent/internal/push';

/** Marks the DO sub-request as a control-plane push rather than a WS upgrade. */
const INTERNAL_PUSH_HEADER = 'X-Pinagent-Internal';

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

    // Control plane → device push (service-to-service; not a WS upgrade).
    if (url.pathname === INTERNAL_PUSH_PATH) {
      return handleInternalPush(request, url, env);
    }

    if (url.pathname !== WS_PATH && url.pathname !== DEVICE_PATH) {
      return new Response('not found', { status: 404 });
    }
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected websocket upgrade', { status: 426 });
    }

    const auth = await verifyToken(request, url, env);
    if (!auth) return new Response('unauthorized', { status: 401 });

    const side = url.pathname === DEVICE_PATH ? 'device' : 'client';
    // Key the DO by tenant + session (never session alone) so a caller-chosen
    // sessionId can't collide across tenants. See `relayDoName`.
    const id = env.RELAY.idFromName(relayDoName(auth.tenantId, auth.sessionId));
    const stub = env.RELAY.get(id);

    // Forward the upgrade to the session's Durable Object, tagging which
    // side of the relay this socket is and (for clients) the verified
    // member role so the DO can apply per-connection RBAC. The role comes
    // from the trusted token, never from a client-supplied header.
    const forwarded = new Request(request, { headers: new Headers(request.headers) });
    forwarded.headers.set('X-Pinagent-Role', side);
    // Strip any client-supplied copies before setting the trusted, token-derived
    // values (spoof-proof, same as the member-role header).
    forwarded.headers.delete('X-Pinagent-Member-Role');
    forwarded.headers.delete('X-Pinagent-Tenant');
    forwarded.headers.delete('X-Pinagent-Session');
    forwarded.headers.set('X-Pinagent-Tenant', auth.tenantId);
    forwarded.headers.set('X-Pinagent-Session', auth.sessionId);
    if (side === 'client' && auth.role) {
      forwarded.headers.set('X-Pinagent-Member-Role', auth.role);
    }
    return stub.fetch(forwarded);
  },
};

/**
 * Control-plane → device push. The cloud POSTs a frame (e.g. a
 * `set_branch_routing` ClientMessage) for a specific session; we authenticate
 * with the shared `RELAY_INTERNAL_SECRET` and forward it to that session's
 * Durable Object, which sends it down the connected device socket.
 *
 *   POST /__pinagent/internal/push?tenant=<tenantId>&session=<sessionId>
 *     Authorization: Bearer <RELAY_INTERNAL_SECRET>
 *     body: the raw frame to deliver
 *   → 200 { delivered: true } | 404 { delivered: false } (no device connected)
 *
 * `tenant` is required so the push resolves to the same tenant-scoped Durable
 * Object the device connected to (see `relayDoName`).
 *
 * Fails closed when the secret is unset (the endpoint is disabled, not open).
 */
async function handleInternalPush(request: Request, url: URL, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }
  if (!env.RELAY_INTERNAL_SECRET) {
    return new Response('internal push disabled', { status: 503 });
  }
  if (!isAuthorizedInternal(request.headers.get('Authorization'), env.RELAY_INTERNAL_SECRET)) {
    return new Response('unauthorized', { status: 401 });
  }
  const tenantId = url.searchParams.get('tenant') ?? '';
  const sessionId = url.searchParams.get('session') ?? '';
  if (!tenantId || !sessionId) {
    return new Response('missing tenant or session', { status: 400 });
  }

  const body = await request.text();
  const stub = env.RELAY.get(env.RELAY.idFromName(relayDoName(tenantId, sessionId)));
  // Re-issue as a plain (non-upgrade) POST the DO recognizes via the marker
  // header; the DO forwards the body to its device socket.
  const forwarded = new Request('https://relay-do/internal/push', {
    method: 'POST',
    headers: { [INTERNAL_PUSH_HEADER]: 'push', 'content-type': 'application/json' },
    body,
  });
  return stub.fetch(forwarded);
}

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
    return {
      tenantId: result.claims.tenantId,
      sessionId: result.claims.sessionId,
      role: result.claims.role,
    };
  }

  // Dev fallback — NOT for production (no secret configured).
  const sessionId = url.searchParams.get('session') ?? '';
  if (!sessionId) return null;
  return { tenantId: sessionId, sessionId };
}

export { RelaySession };
