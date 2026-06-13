// SPDX-License-Identifier: Apache-2.0
/**
 * Pure submit-outcome reducer (ticket 002).
 *
 * `onSubmit` in Pinagent.tsx used to clear the composer (comment, pick,
 * screenshot) UNCONDITIONALLY after `submitFeedback()` returned — so a Metro
 * restart, a network blip, or a release build at the moment of submit threw
 * away the typed comment, the picked anchor, and the screenshot, leaving the
 * user with a 2.5s toast and a blank composer.
 *
 * This module computes the next composer state from a `SubmitResult` so the
 * "keep the draft on failure, clear only on success" rule is data, not buried
 * UI flow — and is unit-testable here (the RN UI itself is not). Mapping the
 * outcome to React state lives in `onSubmit`; this just decides the shape.
 */

/** The relevant submit result fields (a subset of transport's `SubmitResult`). */
export interface SubmitOutcomeInput {
  ok: boolean;
  id?: string;
  agentSpawned?: boolean;
  error?: string;
}

/** What the composer should do next, given a submit result. */
export interface SubmitOutcome {
  /**
   * `'clear'` — wipe the composer (comment/pick/shot) and go idle (success).
   * `'keep'` — retain the composer and surface the error inline + offer Retry.
   */
  composer: 'clear' | 'keep';
  /** Inline error to show under the composer when `composer === 'keep'`. */
  error: string | null;
  /**
   * When a run was spawned, the id to open as a live stream. Null when nothing
   * to stream (spawn off, or a failed submit).
   */
  streamId: string | null;
  /**
   * Transient toast text for the non-streaming success/failure paths, or null
   * when the outcome opens a stream instead (which has its own UI). Kept for a
   * filed-for-pull-mode confirmation; failures show inline, not a toast.
   */
  toast: string | null;
}

/**
 * Decide the next composer state from a submit result.
 *
 * - Failure (`ok === false`): keep the composer + its draft, surface the error
 *   inline (never a vanishing toast), no stream, no clear. Retry re-submits the
 *   retained payload.
 * - Success with a spawned agent: clear the composer and open the stream.
 * - Success without a spawned agent (spawn off / pull mode): clear the composer
 *   and show a transient "Sent" toast.
 */
export function submitOutcome(result: SubmitOutcomeInput): SubmitOutcome {
  if (!result.ok) {
    return {
      composer: 'keep',
      error: `Failed: ${result.error ?? 'unknown'}`,
      streamId: null,
      toast: null,
    };
  }
  if (result.agentSpawned && result.id) {
    return { composer: 'clear', error: null, streamId: result.id, toast: null };
  }
  return { composer: 'clear', error: null, streamId: null, toast: 'Sent' };
}
