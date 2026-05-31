// SPDX-License-Identifier: Elastic-2.0
'use client';

import { Badge } from '@pinagent/ui/components/ui/badge';
import { Button } from '@pinagent/ui/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@pinagent/ui/components/ui/card';
import { cn } from '@pinagent/ui/lib/utils';
import type { Member } from './api-client';
import { selectClassName } from './form-controls';
import { formatDate } from './format';

const ROLES = ['viewer', 'member', 'admin', 'owner'] as const;

/** Best human label for a member, for keys/aria/confirm prompts. */
export function memberLabel(m: Member): string {
  return m.displayName ?? m.email ?? m.userId;
}

/**
 * The org roster with inline admin controls: a per-row role `<select>` and a
 * Remove button. The handlers call the control plane (via the container); the
 * server is the source of truth for who may do what — a denied change (403) or
 * a last-owner guard (409) surfaces as an error above the table.
 */
export function MembersTable({
  members,
  onChangeRole,
  onRemove,
}: {
  members: Member[];
  onChangeRole: (userId: string, role: string) => void;
  onRemove: (member: Member) => void;
}) {
  return (
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
                <th className="py-2" />
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
                    <select
                      className={cn(selectClassName, 'h-8 w-auto')}
                      value={m.role}
                      aria-label={`Role for ${memberLabel(m)}`}
                      onChange={(e) => onChangeRole(m.userId, e.target.value)}
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2">
                    <Badge variant="outline">{m.status}</Badge>
                  </td>
                  <td className="py-2 text-muted-foreground">
                    {m.joinedAt ? formatDate(m.joinedAt) : '—'}
                  </td>
                  <td className="py-2 text-right">
                    <Button type="button" variant="outline" size="sm" onClick={() => onRemove(m)}>
                      Remove
                    </Button>
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
