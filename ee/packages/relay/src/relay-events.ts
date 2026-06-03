// SPDX-License-Identifier: Elastic-2.0

/**
 * Lifecycle events the relay reports to the control plane — the relay→cloud
 * channel. The relay Worker is the sender (a future change has the Durable
 * Object POST these on connect/disconnect); `@pinagent/cloud`'s ingest
 * endpoint is the receiver. Defined here so both ends share one shape.
 */

export type RelayEventType =
  | 'device.connected'
  | 'device.disconnected'
  | 'client.connected'
  | 'client.disconnected';

export interface RelayLifecycleEvent {
  type: RelayEventType;
  /** Tenant the session belongs to (the session token's `tenantId`). */
  organizationId: string;
  /** Relay session id. */
  sessionId: string;
  /** ISO-8601 time the event occurred (stamped by the relay). */
  occurredAt: string;
  /**
   * ISO-8601 time the *connection* opened — a stable identity for this socket
   * generation, carried on both the `connected` and the matching
   * `disconnected` event. The control plane uses it to ignore a stale
   * disconnect for a connection that has since been superseded by a reconnect
   * (so the active-session row for the live connection isn't dropped).
   */
  connectedAt?: string;
  /** The member, for client-side events; absent for device events. */
  userId?: string;
  /**
   * For `*.disconnected` events: how long the connection was open, in
   * milliseconds (the relay computes it from its own clock). The control plane
   * meters this as connection time.
   */
  durationMs?: number;
}

/** Max events accepted in one ingest call — a backstop against abuse. */
export const MAX_RELAY_EVENT_BATCH = 100;

const EVENT_TYPES: readonly RelayEventType[] = [
  'device.connected',
  'device.disconnected',
  'client.connected',
  'client.disconnected',
];

export function isRelayEventType(value: unknown): value is RelayEventType {
  return typeof value === 'string' && (EVENT_TYPES as readonly string[]).includes(value);
}

/**
 * Structurally validate an ingest batch (`{ events: [...] }`). Returns the
 * parsed events, or `null` if the shape is wrong or the batch is too large.
 */
export function parseRelayEventBatch(value: unknown): RelayLifecycleEvent[] | null {
  if (typeof value !== 'object' || value === null) return null;
  const { events } = value as Record<string, unknown>;
  if (!Array.isArray(events) || events.length > MAX_RELAY_EVENT_BATCH) return null;

  const parsed: RelayLifecycleEvent[] = [];
  for (const raw of events) {
    if (typeof raw !== 'object' || raw === null) return null;
    const e = raw as Record<string, unknown>;
    if (!isRelayEventType(e.type)) return null;
    if (!nonEmptyString(e.organizationId)) return null;
    if (!nonEmptyString(e.sessionId)) return null;
    if (!nonEmptyString(e.occurredAt)) return null;
    if (e.connectedAt !== undefined && !nonEmptyString(e.connectedAt)) return null;
    if (e.userId !== undefined && typeof e.userId !== 'string') return null;
    if (e.durationMs !== undefined && !nonNegativeNumber(e.durationMs)) return null;
    parsed.push({
      type: e.type,
      organizationId: e.organizationId,
      sessionId: e.sessionId,
      occurredAt: e.occurredAt,
      ...(typeof e.connectedAt === 'string' ? { connectedAt: e.connectedAt } : {}),
      ...(typeof e.userId === 'string' ? { userId: e.userId } : {}),
      ...(typeof e.durationMs === 'number' ? { durationMs: e.durationMs } : {}),
    });
  }
  return parsed;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function nonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
