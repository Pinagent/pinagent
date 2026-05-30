// SPDX-License-Identifier: Elastic-2.0
'use client';

import { Badge } from '@pinagent/ui/components/ui/badge';
import { Button } from '@pinagent/ui/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@pinagent/ui/components/ui/card';
import { Input } from '@pinagent/ui/components/ui/input';
import { type FormEvent, useState } from 'react';
import type { Invitation, MemberInviteInput } from './api-client';
import { Field, FormError, selectClassName } from './form-controls';

/** Roles an admin can invite into (owner is assigned out-of-band, not invited). */
const INVITE_ROLES = ['viewer', 'member', 'admin'] as const;

/** Email + role form. Validates lightly; the server is the source of truth. */
export function InviteForm({
  onSubmit,
}: {
  onSubmit: (input: MemberInviteInput) => Promise<void>;
}) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<string>('member');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed.includes('@')) {
      setError('Enter a valid email address.');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await onSubmit({ email: trimmed, role });
      setEmail('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-56 flex-1">
          <Field label="Invite by email">
            <Input
              type="email"
              placeholder="teammate@acme.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
        </div>
        <Field label="Role">
          <select
            className={selectClassName}
            value={role}
            onChange={(e) => setRole(e.target.value)}
          >
            {INVITE_ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </Field>
        <Button type="submit" disabled={saving}>
          {saving ? 'Inviting…' : 'Invite'}
        </Button>
      </div>
      <FormError error={error} />
    </form>
  );
}

/** Pending-invitations list with a revoke button per row. */
export function PendingInvitations({
  invitations,
  onRevoke,
}: {
  invitations: Invitation[];
  onRevoke: (email: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium text-muted-foreground">Pending invitations</h3>
      {invitations.length === 0 ? (
        <p className="text-sm text-muted-foreground">No pending invitations.</p>
      ) : (
        <table className="w-full text-sm">
          <tbody>
            {invitations.map((inv) => (
              <tr key={inv.email} className="border-t border-border">
                <td className="py-2 font-mono text-xs">{inv.email}</td>
                <td className="py-2">
                  <Badge variant="secondary">{inv.role}</Badge>
                </td>
                <td className="py-2 text-right">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onRevoke(inv.email)}
                  >
                    Revoke
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** The members-admin card: invite form + pending list. */
export function MembersAdmin({
  invitations,
  onInvite,
  onRevoke,
}: {
  invitations: Invitation[];
  onInvite: (input: MemberInviteInput) => Promise<void>;
  onRevoke: (email: string) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Invite members</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <InviteForm onSubmit={onInvite} />
        <PendingInvitations invitations={invitations} onRevoke={onRevoke} />
      </CardContent>
    </Card>
  );
}
