// SPDX-License-Identifier: Apache-2.0
/**
 * Unit tests for the submit-outcome reducer (ticket 002): a failed submit must
 * KEEP the composer draft (so the user can Retry), and only a success clears
 * it. The RN UI itself isn't unit-testable here — this is the pure decision.
 */
import { describe, expect, it } from 'vitest';
import { submitOutcome } from '../src/native/submit-outcome';

describe('submitOutcome', () => {
  it('keeps the draft and surfaces the error inline on a failed submit', () => {
    expect(submitOutcome({ ok: false, error: 'network down' })).toEqual({
      composer: 'keep',
      error: 'Failed: network down',
      streamId: null,
      toast: null,
    });
  });

  it('preserves the verbatim release-build message', () => {
    const out = submitOutcome({ ok: false, error: 'No dev server (release build?)' });
    expect(out.composer).toBe('keep');
    expect(out.error).toBe('Failed: No dev server (release build?)');
    expect(out.toast).toBeNull();
  });

  it('labels a missing error reason as unknown but still keeps the draft', () => {
    expect(submitOutcome({ ok: false })).toEqual({
      composer: 'keep',
      error: 'Failed: unknown',
      streamId: null,
      toast: null,
    });
  });

  it('clears the composer and opens the stream when an agent was spawned', () => {
    expect(submitOutcome({ ok: true, agentSpawned: true, id: 'fb123' })).toEqual({
      composer: 'clear',
      error: null,
      streamId: 'fb123',
      toast: null,
    });
  });

  it('clears the composer and shows a Sent toast for the pull-mode (no spawn) success', () => {
    expect(submitOutcome({ ok: true, agentSpawned: false, id: 'fb123' })).toEqual({
      composer: 'clear',
      error: null,
      streamId: null,
      toast: 'Sent',
    });
  });

  it('does not open a stream when ok but the id is missing', () => {
    const out = submitOutcome({ ok: true, agentSpawned: true });
    expect(out.composer).toBe('clear');
    expect(out.streamId).toBeNull();
    expect(out.toast).toBe('Sent');
  });
});
