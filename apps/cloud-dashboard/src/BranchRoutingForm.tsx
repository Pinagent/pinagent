// SPDX-License-Identifier: Elastic-2.0
'use client';

import type { BranchRoutingPolicy } from '@pinagent/ee-team-features';
import { type FormEvent, useState } from 'react';
import type { BranchRoutingInput } from './api-client';
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
    <form className="form" onSubmit={handleSubmit}>
      <label className="field">
        <span>Default base branch</span>
        <input
          type="text"
          placeholder="Repo default"
          value={defaultBaseBranch}
          onChange={(e) => setDefaultBaseBranch(e.target.value)}
        />
      </label>
      <label className="field">
        <span>Allowed branch patterns (one per line; blank = any)</span>
        <textarea
          rows={4}
          placeholder={'feat/*\nfix/*'}
          value={patterns}
          onChange={(e) => setPatterns(e.target.value)}
        />
      </label>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="form-actions">
        <button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
    </form>
  );
}
