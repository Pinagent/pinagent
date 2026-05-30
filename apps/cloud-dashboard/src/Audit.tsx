// SPDX-License-Identifier: Elastic-2.0

import type { AuditEvent } from '@pinagent/ee-team-features';
import { Badge } from '@pinagent/ui/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@pinagent/ui/components/ui/card';
import type { CloudApiClient } from './api-client';
import { UnauthorizedError } from './api-client';
import { SignIn } from './SignIn';
import { LoadError, Loading } from './states';
import { useAsync } from './use-async';

export interface AuditData {
  events: AuditEvent[];
}

/** Pure, render-only view — exercised directly in tests via renderToStaticMarkup. */
export function AuditView({ events }: AuditData) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Audit log</CardTitle>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No audit events yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-2 font-medium">When</th>
                <th className="py-2 font-medium">Actor</th>
                <th className="py-2 font-medium">Action</th>
                <th className="py-2 font-medium">Target</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e, i) => (
                // The audit log is append-only and has no id; this view renders a
                // single fetched page once and never reorders it, so the row
                // index is a stable key.
                // biome-ignore lint/suspicious/noArrayIndexKey: append-only, render-once list
                <tr key={`${e.occurredAt}-${e.action}-${i}`} className="border-t border-border">
                  <td className="py-2 text-muted-foreground tabular-nums">{e.occurredAt}</td>
                  <td className="py-2 font-mono text-xs">
                    {e.actorUserId ?? <span className="text-muted-foreground">system</span>}
                  </td>
                  <td className="py-2">
                    <Badge variant="outline">{e.action}</Badge>
                  </td>
                  <td className="py-2 font-mono text-xs">
                    {e.targetId ?? <span className="text-muted-foreground">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
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

  if (state.status === 'loading') return <Loading />;
  if (state.status === 'error') {
    if (state.error instanceof UnauthorizedError) return <SignIn />;
    return <LoadError label="audit log" error={state.error} />;
  }

  return <AuditView events={state.value.events} />;
}
