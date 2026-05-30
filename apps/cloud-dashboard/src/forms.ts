// SPDX-License-Identifier: Elastic-2.0
import { planById } from '@pinagent/ee-billing';
import type { BranchRoutingInput, CostControlInput, SubscriptionInput } from './api-client';

/**
 * Pure form parsing/validation, mirroring the control plane's
 * `parseSubscriptionBody` / `parseCostControlBody` / `parseBranchRoutingBody`.
 * Kept separate from the React components so the rules are unit-testable
 * without a DOM.
 */

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Raw subscription form fields. */
export interface SubscriptionFields {
  planId: string;
  /** Billing period start; free text mirroring the stored value. */
  currentPeriodStart: string;
}

export function parseSubscriptionForm(fields: SubscriptionFields): ParseResult<SubscriptionInput> {
  const planId = fields.planId.trim();
  // Mirror the server: a known plan id is required (it rejects unknown plans).
  if (!planById(planId)) {
    return { ok: false, error: `Unknown plan "${planId || '(blank)'}".` };
  }
  const currentPeriodStart = fields.currentPeriodStart.trim();
  if (currentPeriodStart === '') {
    return { ok: false, error: 'Billing period start is required.' };
  }
  return { ok: true, value: { planId, currentPeriodStart } };
}

/** Raw cost-control form fields (all strings, as they come off inputs). */
export interface CostControlFields {
  /** Session cap; blank means "no cap" (null). */
  cap: string;
  enforcement: string;
}

export function parseCostControlForm(fields: CostControlFields): ParseResult<CostControlInput> {
  const capText = fields.cap.trim();
  let maxRelaySessionsPerPeriod: number | null;
  if (capText === '') {
    maxRelaySessionsPerPeriod = null;
  } else {
    const n = Number(capText);
    if (!Number.isInteger(n) || n < 0) {
      return { ok: false, error: 'Session cap must be a whole number ≥ 0, or blank for no cap.' };
    }
    maxRelaySessionsPerPeriod = n;
  }
  if (fields.enforcement !== 'block' && fields.enforcement !== 'warn') {
    return { ok: false, error: 'Enforcement must be "block" or "warn".' };
  }
  return { ok: true, value: { maxRelaySessionsPerPeriod, enforcement: fields.enforcement } };
}

/** Raw branch-routing form fields. */
export interface BranchRoutingFields {
  /** Default base branch; blank means "repo default" (null). */
  defaultBaseBranch: string;
  /** Allowed patterns, one per line and/or comma-separated. Blank = any. */
  allowedBranchPatterns: string;
}

export function parseBranchRoutingForm(
  fields: BranchRoutingFields,
): ParseResult<BranchRoutingInput> {
  const base = fields.defaultBaseBranch.trim();
  const allowedBranchPatterns = fields.allowedBranchPatterns
    .split(/[\n,]/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  return {
    ok: true,
    value: { defaultBaseBranch: base === '' ? null : base, allowedBranchPatterns },
  };
}

/** Render an allowed-patterns array back into the textarea representation. */
export function patternsToText(patterns: string[]): string {
  return patterns.join('\n');
}
