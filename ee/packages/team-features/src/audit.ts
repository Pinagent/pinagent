// SPDX-License-Identifier: Elastic-2.0

/**
 * Append-only audit log for governance-relevant cloud actions — who did what,
 * to which org, when. The control plane records events at security boundaries
 * (login, relay-session issuance, authorization denials); a future admin
 * surface reads them back.
 *
 * This module is the driver-free domain core: the event shape, the `AuditSink`
 * port, and an in-memory implementation for tests/dev. The Postgres-backed
 * sink lives in the cloud app (the composition root owns persistence), the
 * same split as `ee-auth`'s `MembershipStore`.
 */

export interface AuditEvent {
  /** When the action occurred, ISO-8601. */
  occurredAt: string;
  /** Tenant the action belongs to. */
  organizationId: string;
  /** The acting user, or `null` when unauthenticated (e.g. a denied login). */
  actorUserId: string | null;
  /** Dotted action name — see {@link AUDIT_ACTIONS}. */
  action: string;
  /** Optional subject of the action (e.g. the relay session id). */
  targetId?: string;
  /** Free-form structured context (role, denial reason, …). */
  metadata?: Record<string, unknown>;
}

export interface AuditQuery {
  organizationId: string;
  /** Max rows, newest first (default 100). */
  limit?: number;
}

/** Persistence boundary for the audit log. Append + read-back. */
export interface AuditSink {
  record(event: AuditEvent): Promise<void>;
  list(query: AuditQuery): Promise<AuditEvent[]>;
}

/** The action vocabulary the control plane emits — kept here as one source. */
export const AUDIT_ACTIONS = {
  login: 'sso.login',
  sessionIssued: 'relay.session.issued',
  sessionDenied: 'relay.session.denied',
  /** A cost control blocked issuance (enforcement: block). */
  costCapBlocked: 'cost.cap.blocked',
  /** A cost control was exceeded but issuance was allowed (enforcement: warn). */
  costCapWarning: 'cost.cap.warning',
} as const;

export const DEFAULT_AUDIT_LIMIT = 100;

/**
 * In-memory sink for tests and local dev. Not durable; events vanish on
 * restart and aren't shared across processes.
 */
export function createInMemoryAuditSink(): AuditSink & { readonly events: readonly AuditEvent[] } {
  const events: AuditEvent[] = [];
  return {
    events,
    async record(event: AuditEvent): Promise<void> {
      events.push(event);
    },
    async list(query: AuditQuery): Promise<AuditEvent[]> {
      return events
        .filter((e) => e.organizationId === query.organizationId)
        .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1))
        .slice(0, query.limit ?? DEFAULT_AUDIT_LIMIT);
    },
  };
}
