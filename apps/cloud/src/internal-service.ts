// SPDX-License-Identifier: Elastic-2.0
import { parseRelayEventBatch } from '@pinagent/ee-relay';
import type { AuditSink } from '@pinagent/ee-team-features';

/**
 * Internal ingest for relay→control-plane lifecycle events — the receiving
 * half of the relay reporting channel. The relay Worker POSTs authenticated
 * batches of connect/disconnect events here; we record them to the audit log.
 *
 *   POST /internal/relay/events   Authorization: Bearer <RELAY_INTERNAL_SECRET>
 *     body { events: RelayLifecycleEvent[] } → 200 { recorded }
 *
 * This is service-to-service (relay ↔ control plane), authenticated by a
 * shared secret — not an end-user endpoint.
 */
export interface InternalServiceDeps {
  audit: AuditSink;
  /** Shared secret the relay presents as a bearer token. */
  relayInternalSecret: string;
}

export async function handleRelayEvents(
  request: Request,
  deps: InternalServiceDeps,
): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const provided = bearer(request.headers.get('Authorization'));
  if (!provided || !timingSafeEqual(provided, deps.relayInternalSecret)) {
    return json({ error: 'unauthorized' }, 401);
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, 400);
  }
  const events = parseRelayEventBatch(raw);
  if (!events) return json({ error: 'invalid event batch' }, 400);

  for (const event of events) {
    await deps.audit.record({
      occurredAt: event.occurredAt,
      organizationId: event.organizationId,
      actorUserId: event.userId ?? null,
      action: `relay.${event.type}`,
      targetId: event.sessionId,
    });
  }
  return json({ recorded: events.length }, 200);
}

function bearer(header: string | null): string | null {
  if (!header) return null;
  const token = /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim();
  return token ? token : null;
}

/** Length-aware constant-time-ish compare for the shared secret. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
