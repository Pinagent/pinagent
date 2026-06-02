// SPDX-License-Identifier: Elastic-2.0
import { USAGE_KINDS, type UsageSummary } from '@pinagent/ee-billing';
import { Card, CardContent } from '@pinagent/ui/components/ui/card';
import { useState } from 'react';
import type { CloudApiClient, Invitation, Member } from './api-client';
import { CloudApiError, UnauthorizedError } from './api-client';
import { formatDuration } from './format';
import { MembersAdmin } from './MembersAdmin';
import { MembersTable, memberLabel } from './MembersTable';
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
    </div>
  );
}

interface OverviewLoad extends OverviewData {
  invitations: Invitation[];
}

/** Map a member-mutation failure to a friendly message. */
function memberActionError(err: unknown): string {
  if (err instanceof CloudApiError) {
    if (err.status === 409) return 'That change would leave the organization without an owner.';
    if (err.status === 403) return 'You don’t have permission to make that change.';
  }
  return err instanceof Error ? err.message : String(err);
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
  const [actionError, setActionError] = useState<string | null>(null);

  async function runAction(action: () => Promise<unknown>): Promise<void> {
    setActionError(null);
    try {
      await action();
      reload();
    } catch (err) {
      setActionError(memberActionError(err));
    }
  }

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
      {actionError ? (
        <p className="text-sm text-destructive" role="alert">
          {actionError}
        </p>
      ) : null}
      <MembersTable
        members={state.value.members}
        onChangeRole={(userId, role) =>
          runAction(() => client.changeMemberRole(organizationId, userId, role))
        }
        onRemove={(m) => {
          if (!window.confirm(`Remove ${memberLabel(m)} from the organization?`)) return;
          runAction(() => client.removeMember(organizationId, m.userId));
        }}
      />
      <MembersAdmin
        invitations={state.value.invitations}
        onInvite={async (input) => {
          // InviteForm surfaces a thrown error in its own field, so let it propagate.
          await client.inviteMember(organizationId, input);
          reload();
        }}
        onRevoke={(email) =>
          // Revoke is fire-and-forget from the list; route it through runAction so a
          // failure (403/network) surfaces in the action banner instead of becoming
          // a silent unhandled rejection.
          runAction(() => client.revokeInvitation(organizationId, email))
        }
      />
    </div>
  );
}
