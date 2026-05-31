// SPDX-License-Identifier: Elastic-2.0
import { USAGE_KINDS, type UsageSummary } from '@pinagent/ee-billing';
import { Badge } from '@pinagent/ui/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@pinagent/ui/components/ui/card';
import { useState } from 'react';
import type { CloudApiClient, Invitation, Member } from './api-client';
import { UnauthorizedError } from './api-client';
import { formatDate, formatDuration } from './format';
import { MembersAdmin } from './MembersAdmin';
import { SignIn } from './SignIn';
import { LoadError, Loading } from './states';
import { useAsync } from './use-async';

export interface OverviewData {
  usage: UsageSummary;
  members: Member[];
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}

/** Pure, render-only view — exercised directly in tests via renderToStaticMarkup. */
export function OverviewView({ usage, members }: OverviewData) {
  const sessions = usage[USAGE_KINDS.relaySession] ?? 0;
  const connectionSeconds = usage[USAGE_KINDS.relayConnectionSeconds] ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Relay sessions" value={sessions.toLocaleString()} />
        <Stat label="Connection time" value={formatDuration(connectionSeconds)} />
        <Stat label="Members" value={members.length.toLocaleString()} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
        </CardHeader>
        <CardContent>
          {members.length === 0 ? (
            <p className="text-sm text-muted-foreground">No members yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-2 font-medium">Member</th>
                  <th className="py-2 font-medium">Role</th>
                  <th className="py-2 font-medium">Status</th>
                  <th className="py-2 font-medium">Joined</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.userId} className="border-t border-border">
                    <td className="py-2">
                      <div>{m.displayName ?? m.email ?? m.userId}</div>
                      {m.displayName && m.email ? (
                        <div className="text-xs text-muted-foreground">{m.email}</div>
                      ) : null}
                    </td>
                    <td className="py-2">
                      <Badge variant="secondary">{m.role}</Badge>
                    </td>
                    <td className="py-2">
                      <Badge variant="outline">{m.status}</Badge>
                    </td>
                    <td className="py-2 text-muted-foreground">
                      {m.joinedAt ? formatDate(m.joinedAt) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

interface OverviewLoad extends OverviewData {
  invitations: Invitation[];
}

/** Data-loading container. */
export function Overview({
  client,
  organizationId,
}: {
  client: CloudApiClient;
  organizationId: string;
}) {
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);

  const state = useAsync<OverviewLoad>(async () => {
    const [usage, members, invitations] = await Promise.all([
      client.getUsage(organizationId),
      client.getMembers(organizationId),
      client.getInvitations(organizationId),
    ]);
    return { usage, members, invitations };
  }, [client, organizationId, reloadKey]);

  if (state.status === 'loading') return <Loading />;
  if (state.status === 'error') {
    if (state.error instanceof UnauthorizedError) return <SignIn />;
    return <LoadError label="overview" error={state.error} />;
  }
  return (
    <div className="flex flex-col gap-6">
      <OverviewView usage={state.value.usage} members={state.value.members} />
      <MembersAdmin
        invitations={state.value.invitations}
        onInvite={async (input) => {
          await client.inviteMember(organizationId, input);
          reload();
        }}
        onRevoke={async (email) => {
          await client.revokeInvitation(organizationId, email);
          reload();
        }}
      />
    </div>
  );
}
