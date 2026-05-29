// SPDX-License-Identifier: Elastic-2.0
'use client';

import type { CostControl } from '@pinagent/ee-team-features';
import { type FormEvent, useState } from 'react';
import type { CostControlInput } from './api-client';
import { parseCostControlForm } from './forms';

/**
 * Edit form for cost controls. Validation lives in `parseCostControlForm`;
 * this component just wires inputs to it and reports errors. On a successful
 * `onSubmit` the parent unmounts the form (so we don't reset state here).
 */
export function CostControlForm({
  initial,
  onSubmit,
  onCancel,
}: {
  initial: CostControl | null;
  onSubmit: (input: CostControlInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [cap, setCap] = useState(
    initial?.maxRelaySessionsPerPeriod == null ? '' : String(initial.maxRelaySessionsPerPeriod),
  );
  const [enforcement, setEnforcement] = useState<string>(initial?.enforcement ?? 'block');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = parseCostControlForm({ cap, enforcement });
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
        <span>Max relay sessions / period</span>
        <input
          type="number"
          min="0"
          step="1"
          placeholder="No cap"
          value={cap}
          onChange={(e) => setCap(e.target.value)}
        />
      </label>
      <label className="field">
        <span>Enforcement</span>
        <select value={enforcement} onChange={(e) => setEnforcement(e.target.value)}>
          <option value="block">Block over cap</option>
          <option value="warn">Warn only</option>
        </select>
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
