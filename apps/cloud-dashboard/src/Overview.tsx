// SPDX-License-Identifier: Elastic-2.0
import type { OrganizationMembership } from '@pinagent/ee-auth';
import { USAGE_KINDS, type UsageSummary } from '@pinagent/ee-billing';
import type { CloudApiClient } from './api-client';
import { UnauthorizedError } from './api-client';
import { formatDuration } from './format';
import { SignIn } from './SignIn';
import { useAsync } from './use-async';

export interface OverviewData {
  usage: UsageSummary;
  members: OrganizationMembership[];
}

/** Pure, render-only view — exercised directly in tests via renderToStaticMarkup. */
export function OverviewView({ usage, members }: OverviewData) {
  const sessions = usage[USAGE_KINDS.relaySession] ?? 0;
  const connectionSeconds = usage[USAGE_KINDS.relayConnectionSeconds] ?? 0;

  return (
    <section className="overview">
      <h2>Overview</h2>
      <dl className="stats">
        <div className="stat">
          <dt>Relay sessions</dt>
          <dd>{sessions.toLocaleString()}</dd>
        </div>
        <div className="stat">
          <dt>Connection time</dt>
          <dd>{formatDuration(connectionSeconds)}</dd>
        </div>
        <div className="stat">
          <dt>Members</dt>
          <dd>{members.length.toLocaleString()}</dd>
        </div>
      </dl>

      <h3>Members</h3>
      {members.length === 0 ? (
        <p className="empty">No members yet.</p>
      ) : (
        <table className="members">
          <thead>
            <tr>
              <th>User</th>
              <th>Role</th>
              <th>Status</th>
              <th>Joined</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.userId}>
                <td>{m.userId}</td>
                <td>{m.role}</td>
                <td>{m.status}</td>
                <td>{m.joinedAt ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** Data-loading container. */
export function Overview({
  client,
  organizationId,
}: {
  client: CloudApiClient;
  organizationId: string;
}) {
  const state = useAsync<OverviewData>(async () => {
    const [usage, members] = await Promise.all([
      client.getUsage(organizationId),
      client.getMembers(organizationId),
    ]);
    return { usage, members };
  }, [client, organizationId]);

  if (state.status === 'loading') return <p className="loading">Loading…</p>;
  if (state.status === 'error') {
    if (state.error instanceof UnauthorizedError) return <SignIn />;
    return (
      <p className="error" role="alert">
        Failed to load overview: {String(state.error)}
      </p>
    );
  }
  return <OverviewView usage={state.value.usage} members={state.value.members} />;
}
