// SPDX-License-Identifier: Elastic-2.0
'use client';

import type { BranchRoutingPolicy } from '@pinagent/ee-team-features';
import { Button } from '@pinagent/ui/components/ui/button';
import { Input } from '@pinagent/ui/components/ui/input';
import { Textarea } from '@pinagent/ui/components/ui/textarea';
import { type FormEvent, useState } from 'react';
import type { BranchRoutingInput } from './api-client';
import { Field, FormError } from './form-controls';
import { parseBranchRoutingForm, patternsToText } from './forms';

/**
 * Edit form for the branch-routing policy. Patterns are entered one per line
 * (or comma-separated); `parseBranchRoutingForm` normalizes them.
 */
export function BranchRoutingForm({
  initial,
  onSubmit,
  onCancel,
}: {
  initial: BranchRoutingPolicy | null;
  onSubmit: (input: BranchRoutingInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [defaultBaseBranch, setDefaultBaseBranch] = useState(initial?.defaultBaseBranch ?? '');
  const [patterns, setPatterns] = useState(patternsToText(initial?.allowedBranchPatterns ?? []));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = parseBranchRoutingForm({ defaultBaseBranch, allowedBranchPatterns: patterns });
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await onSubmit(parsed.value);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <Field label="Default base branch">
        <Input
          type="text"
          placeholder="Repo default"
          value={defaultBaseBranch}
          onChange={(e) => setDefaultBaseBranch(e.target.value)}
        />
      </Field>
      <Field label="Allowed branch patterns (one per line; blank = any)">
        <Textarea
          rows={4}
          placeholder={'feat/*\nfix/*'}
          value={patterns}
          onChange={(e) => setPatterns(e.target.value)}
        />
      </Field>
      <FormError error={error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
