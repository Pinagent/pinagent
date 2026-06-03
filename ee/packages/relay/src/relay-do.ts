// SPDX-License-Identifier: Elastic-2.0
import { isRole, type Role } from '@pinagent/ee-auth';
import type { RelayEventType } from './relay-events';
import { type ClientAttachment, RelayHub, type RelaySocket } from './relay-hub';
import {
  createRelayReporter,
  type RelayReporter,
  relayReporterConfigFromEnv,
} from './relay-reporter';
import type { Env } from './worker';

type Side = 'device' | 'client';

/**
 * Persisted per-socket state. `side` is the connection role (which end of the
 * relay this socket is); the fields inherited from {@link ClientAttachment}
 * — including the member's RBAC `role` — describe a client socket. `tenantId`
 * + `sessionId` (forwarded from the verified token) are kept so a lifecycle
 * event can be reported on close, even after hibernation.
 */
interface RelayAttachment extends Partial<ClientAttachment> {
  side: Side;
  tenantId?: string;
  sessionId?: string;
  /** Epoch ms the socket connected — used to compute connection duration. */
  connectedAtMs?: number;
}

const SIDE_HEADER = 'X-Pinagent-Role';
const MEMBER_ROLE_HEADER = 'X-Pinagent-Member-Role';
const TENANT_HEADER = 'X-Pinagent-Tenant';
const SESSION_HEADER = 'X-Pinagent-Session';
/** Set by the Worker on a control-plane push (a non-upgrade POST). */
const INTERNAL_HEADER = 'X-Pinagent-Internal';

/**
 * `RelaySession` — one Durable Object instance per tenant session. Holds
 * the live WebSockets (device + clients) and delegates all routing to a
 * `RelayHub`.
 *
 * Uses the WebSocket Hibernation API (`acceptWebSocket`) so an idle
 * session costs nothing while connections stay open. Because hibernation
 * discards in-memory state, the hub is lazily rebuilt from the surviving
 * sockets (`getWebSockets()`) and their serialized attachments via
 * `getHub()`, and each client's subscription set is persisted back onto
 * its socket attachment on every mutation.
 */
export class RelaySession {
  private readonly ctx: DurableObjectState;
  private hub: RelayHub | null = null;
  /** Stable RelaySocket wrapper per live WebSocket (hub keys by identity). */
  private readonly socketFor = new Map<WebSocket, RelaySocket>();
  /** Reports connect/disconnect to the control plane (no-op if unconfigured). */
  private readonly reporter: RelayReporter;

  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx;
    this.reporter = createRelayReporter(relayReporterConfigFromEnv(env));
  }

  async fetch(request: Request): Promise<Response> {
    // Control-plane push (authenticated at the Worker edge): deliver the
    // frame to this session's device socket. Not a WebSocket upgrade.
    if (request.headers.get(INTERNAL_HEADER) === 'push') {
      const raw = await request.text();
      const delivered = this.getHub().pushToDevice(raw);
      return new Response(JSON.stringify({ delivered }), {
        status: delivered ? 200 : 404,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected websocket upgrade', { status: 426 });
    }
    const side: Side = request.headers.get(SIDE_HEADER) === 'device' ? 'device' : 'client';
    const tenantId = request.headers.get(TENANT_HEADER) ?? undefined;
    const sessionId = request.headers.get(SESSION_HEADER) ?? undefined;
    const connectedAtMs = Date.now();

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    const hub = this.getHub();
    const sock = this.wrap(server);

    if (side === 'device') {
      server.serializeAttachment({
        side: 'device',
        tenantId,
        sessionId,
        connectedAtMs,
      } satisfies RelayAttachment);
      this.ctx.acceptWebSocket(server, ['device']);
      hub.attachDevice(sock);
    } else {
      const role = parseRole(request.headers.get(MEMBER_ROLE_HEADER));
      server.serializeAttachment({
        side: 'client',
        feedbackIds: [],
        project: false,
        role,
        tenantId,
        sessionId,
        connectedAtMs,
      });
      this.ctx.acceptWebSocket(server, ['client']);
      hub.attachClient(sock, role);
    }

    this.report(`${side}.connected`, { tenantId, sessionId, connectedAtMs });
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    const raw = typeof message === 'string' ? message : new TextDecoder().decode(message);
    const hub = this.getHub();
    const sock = this.wrap(ws);
    const att = this.readAttachment(ws);
    if (att.side === 'device') {
      hub.fromDevice(raw);
      return;
    }
    hub.fromClient(sock, raw);
    const snapshot = hub.snapshotClient(sock);
    if (snapshot) {
      // Preserve tenantId/sessionId/connectedAtMs — re-serializing only the
      // subscription snapshot would otherwise drop them, losing the disconnect
      // report and its duration.
      ws.serializeAttachment({
        side: 'client',
        ...snapshot,
        tenantId: att.tenantId,
        sessionId: att.sessionId,
        connectedAtMs: att.connectedAtMs,
      } satisfies RelayAttachment);
    }
  }

  webSocketClose(ws: WebSocket): void {
    this.detach(ws);
  }

  webSocketError(ws: WebSocket): void {
    this.detach(ws);
  }

  private detach(ws: WebSocket): void {
    const hub = this.getHub();
    const sock = this.wrap(ws);
    const att = this.readAttachment(ws);
    if (att.side === 'device') hub.detachDevice(sock);
    else hub.detachClient(sock);
    this.socketFor.delete(ws);
    // Duration from the relay's own clock (same DO that stamped connect), so
    // it's accurate regardless of clock skew between relay and control plane.
    const durationMs =
      att.connectedAtMs !== undefined ? Math.max(0, Date.now() - att.connectedAtMs) : undefined;
    this.report(`${att.side}.disconnected`, {
      tenantId: att.tenantId,
      sessionId: att.sessionId,
      connectedAtMs: att.connectedAtMs,
      durationMs,
    });
  }

  /**
   * Fire-and-forget a lifecycle event to the control plane. Skipped when the
   * tenant/session aren't known (e.g. dev-fallback with no forwarded headers);
   * `waitUntil` keeps the DO alive until the best-effort POST settles.
   *
   * `connectedAtMs` (when known) is stamped as the event's `connectedAt` — the
   * same value on a connection's `connected` and `disconnected` events — so the
   * control plane can match disconnects to the exact connection generation.
   */
  private report(
    type: RelayEventType,
    info: { tenantId?: string; sessionId?: string; connectedAtMs?: number; durationMs?: number },
  ): void {
    if (!info.tenantId || !info.sessionId) return;
    const connectedAt =
      info.connectedAtMs !== undefined ? new Date(info.connectedAtMs).toISOString() : undefined;
    this.ctx.waitUntil(
      this.reporter.report({
        type,
        organizationId: info.tenantId,
        sessionId: info.sessionId,
        occurredAt: new Date().toISOString(),
        ...(connectedAt !== undefined ? { connectedAt } : {}),
        ...(info.durationMs !== undefined ? { durationMs: info.durationMs } : {}),
      }),
    );
  }

  /** Rebuild the hub from surviving sockets on first use after a wake. */
  private getHub(): RelayHub {
    if (this.hub) return this.hub;
    const hub = new RelayHub();
    for (const ws of this.ctx.getWebSockets()) {
      const att = this.readAttachment(ws);
      const sock = this.wrap(ws);
      if (att.side === 'device') {
        hub.restoreDevice(sock);
      } else {
        hub.restoreClient(sock, {
          feedbackIds: att.feedbackIds ?? [],
          project: att.project ?? false,
          role: att.role,
        });
      }
    }
    this.hub = hub;
    return hub;
  }

  private wrap(ws: WebSocket): RelaySocket {
    let sock = this.socketFor.get(ws);
    if (!sock) {
      sock = {
        send: (data) => {
          try {
            ws.send(data);
          } catch {
            // Socket already closing/closed — drop. Cleanup runs via
            // webSocketClose / webSocketError.
          }
        },
        close: (code, reason) => {
          try {
            ws.close(code, reason);
          } catch {
            // Already closed.
          }
        },
      };
      this.socketFor.set(ws, sock);
    }
    return sock;
  }

  private readAttachment(ws: WebSocket): RelayAttachment {
    return (ws.deserializeAttachment() as RelayAttachment | null) ?? { side: 'client' };
  }
}

function parseRole(value: string | null): Role | undefined {
  return isRole(value) ? value : undefined;
}
