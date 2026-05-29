// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '../src/event-bus';
import { renderTranscript } from '../src/render-transcript';

const RESULT: AgentEvent = {
  type: 'result',
  subtype: 'success',
  numTurns: 2,
  totalCostUsd: 0.0473,
  durationMs: 1200,
};

function initWith(apiKeySource: string): AgentEvent {
  return {
    type: 'init',
    sessionId: 'sess1234',
    model: 'claude',
    permissionMode: 'default',
    apiKeySource,
  };
}

describe('renderTranscript', () => {
  it('returns the empty sentinel for no events', () => {
    expect(renderTranscript([])).toBe('(no events recorded)\n');
  });

  it('renders a plain dollar cost when the run used an API key', () => {
    const out = renderTranscript([initWith('user'), RESULT]);
    expect(out).toContain('$0.0473');
    expect(out).not.toContain('API-equivalent');
  });

  it('relabels notional cost as API-equivalent for an OAuth run', () => {
    const out = renderTranscript([initWith('oauth'), RESULT]);
    expect(out).toContain('≈$0.0473');
    expect(out).toContain('API-equivalent');
    expect(out).toContain('subscription');
  });

  it('falls back to a plain dollar cost when there is no init event', () => {
    // Defensive: a truncated transcript with no init can't know the
    // source, so it shows the raw figure rather than guessing.
    const out = renderTranscript([RESULT]);
    expect(out).toContain('$0.0473');
    expect(out).not.toContain('API-equivalent');
  });
});
