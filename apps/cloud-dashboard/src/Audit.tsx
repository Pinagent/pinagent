// SPDX-License-Identifier: Elastic-2.0

import type { AuditEvent } from '@pinagent/ee-team-features';
import type { CloudApiClient } from './api-client';
import { UnauthorizedError } from './api-client';
import { SignIn } from './SignIn';
import { useAsync } from './use-async';

export interface AuditData {
  events: AuditEvent[];
}

/** Pure, render-only view — exercised directly in tests via renderToStaticMarkup. */
export function AuditView({ events }: AuditData) {
  return (
    <section className="panel">
      <h2>Audit log</h2>
      {events.length === 0 ? (
        <p className="empty">No audit events yet.</p>
      ) : (
        <table className="events">
          <thead>
            <tr>
              <th>When</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Target</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e, i) => (
              // The audit log is append-only and has no id; this view renders a
              // single fetched page once and never reorders it, so the row
              // index is a stable key.
              // biome-ignore lint/suspicious/noArrayIndexKey: append-only, render-once list
              <tr key={`${e.occurredAt}-${e.action}-${i}`}>
                <td>{e.occurredAt}</td>
                <td>{e.actorUserId ?? <span className="muted">system</span>}</td>
                <td>
                  <code>{e.action}</code>
                </td>
                <td>{e.targetId ?? <span className="muted">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** Data-loading container. */
export function Audit({
  client,
  organizationId,
}: {
  client: CloudApiClient;
  organizationId: string;
}) {
  const state = useAsync<AuditData>(async () => {
    const events = await client.getAudit(organizationId);
    return { events };
  }, [client, organizationId]);

  if (state.status === 'loading') return <p className="loading">Loading…</p>;
  if (state.status === 'error') {
    if (state.error instanceof UnauthorizedError) return <SignIn />;
    return (
      <p className="error" role="alert">
        Failed to load audit log: {String(state.error)}
      </p>
    );
  }

  return <AuditView events={state.value.events} />;
}
