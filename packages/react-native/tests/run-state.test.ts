// SPDX-License-Identifier: Apache-2.0
/**
 * Run-state model for the RN widget (src/native/run-state.ts). This is the
 * redesigned, dependency-free state machine the compact agent dock renders:
 * `deriveRunState` folds the run booleans into one state, `runPresentation`
 * maps it to a glyph/tone (never color alone), and `dockModel` aggregates the
 * runs into the hybrid (chip → count bar) + finished-summary layout. RN-runtime
 * code isn't unit-testable here, so this pure layer is the contract.
 */
import { describe, expect, it } from 'vitest';
import {
  type DockRun,
  deriveRunState,
  dockModel,
  type RunState,
  runPresentation,
} from '../src/native/run-state';
import type { AgentEvent } from '../src/native/transcript';

const init: AgentEvent = {
  type: 'init',
  sessionId: 's',
  model: 'm',
  permissionMode: 'p',
  apiKeySource: 'a',
};
const ok: AgentEvent = {
  type: 'result',
  subtype: 'success',
  numTurns: 1,
  totalCostUsd: 0,
  durationMs: 1,
};

function input(over: Partial<Parameters<typeof deriveRunState>[0]> = {}) {
  return { events: [], done: false, transportError: null, answered: {}, ...over };
}

describe('deriveRunState', () => {
  it('is connecting before any event arrives', () => {
    expect(deriveRunState(input())).toBe('connecting');
  });

  it('is working once any event has arrived and the run is live', () => {
    expect(deriveRunState(input({ events: [init] }))).toBe('working');
  });

  it('is awaiting when blocked on an unanswered ask', () => {
    const events: AgentEvent[] = [{ type: 'ask_user', askId: 'q1', question: 'Which?' }];
    expect(deriveRunState(input({ events }))).toBe('awaiting');
  });

  it('leaves awaiting once the ask is answered', () => {
    const events: AgentEvent[] = [{ type: 'ask_user', askId: 'q1', question: 'Which?' }];
    expect(deriveRunState(input({ events, answered: { q1: 'A' } }))).toBe('working');
  });

  it('is done on a clean success result', () => {
    expect(deriveRunState(input({ events: [ok], done: true }))).toBe('done');
  });

  it('is done when the bus simply closed (done with no result event)', () => {
    expect(deriveRunState(input({ events: [init], done: true }))).toBe('done');
  });

  it('is failed when the last result is a non-success subtype', () => {
    const events: AgentEvent[] = [
      { type: 'result', subtype: 'error_max_turns', numTurns: 3, totalCostUsd: 0, durationMs: 1 },
    ];
    expect(deriveRunState(input({ events, done: true }))).toBe('failed');
  });

  it('is failed when an error event terminated the run', () => {
    const events: AgentEvent[] = [{ type: 'error', message: 'boom' }];
    expect(deriveRunState(input({ events, done: true }))).toBe('failed');
  });

  it('treats a transport error as failed, taking precedence over a pending ask', () => {
    const events: AgentEvent[] = [{ type: 'ask_user', askId: 'q1', question: 'Which?' }];
    expect(deriveRunState(input({ events, transportError: 'lost' }))).toBe('failed');
  });
});

describe('runPresentation', () => {
  it('gives every state a distinct glyph (state never rides on color alone)', () => {
    const states: RunState[] = ['connecting', 'working', 'awaiting', 'done', 'failed'];
    const glyphs = states.map((s) => runPresentation(s).glyph);
    expect(new Set(glyphs).size).toBe(states.length);
  });

  it('marks only awaiting as pulsing, and connecting/working/awaiting as active', () => {
    expect(runPresentation('awaiting').pulse).toBe(true);
    expect(runPresentation('working').pulse).toBe(false);
    expect(
      ['connecting', 'working', 'awaiting'].every((s) => runPresentation(s as RunState).active),
    ).toBe(true);
    expect(runPresentation('done').active).toBe(false);
    expect(runPresentation('failed').active).toBe(false);
  });
});

describe('dockModel', () => {
  const run = (id: string, state: RunState): DockRun => ({ id, target: `${id}.tsx:1`, state });

  it('returns empty partitions for no runs', () => {
    const m = dockModel([]);
    expect(m.active).toEqual([]);
    expect(m.finished).toEqual([]);
    expect(m.collapseActive).toBe(false);
  });

  it('keeps a single active run uncollapsed (the chip case)', () => {
    const m = dockModel([run('a', 'working')]);
    expect(m.collapseActive).toBe(false);
    expect(m.active).toHaveLength(1);
  });

  it('collapses two or more active runs into a count bar', () => {
    const m = dockModel([run('a', 'working'), run('b', 'connecting')]);
    expect(m.collapseActive).toBe(true);
    expect(m.activeHeadline).toBe('2 agents');
  });

  it('surfaces the awaiting count in the headline and summary state', () => {
    const m = dockModel([run('a', 'working'), run('b', 'awaiting'), run('c', 'working')]);
    expect(m.awaitingCount).toBe(1);
    expect(m.activeHeadline).toBe('3 agents · 1 needs you');
    // Attention-first: the awaiting run sorts to the front and drives the bar.
    expect(m.active[0].id).toBe('b');
    expect(m.summaryState).toBe('awaiting');
  });

  it('sorts active attention-first but stably within a tone', () => {
    const m = dockModel([run('a', 'working'), run('b', 'working'), run('c', 'connecting')]);
    expect(m.active.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('partitions finished runs out of active and flags failures', () => {
    const m = dockModel([run('a', 'working'), run('b', 'done'), run('c', 'failed')]);
    expect(m.active.map((r) => r.id)).toEqual(['a']);
    expect(m.finished.map((r) => r.id)).toEqual(['b', 'c']);
    expect(m.finishedHasFailure).toBe(true);
  });

  it('reports no failure when every finished run is done', () => {
    const m = dockModel([run('a', 'done'), run('b', 'done')]);
    expect(m.finishedHasFailure).toBe(false);
    // All finished → no active runs, nothing to collapse.
    expect(m.collapseActive).toBe(false);
  });
});
