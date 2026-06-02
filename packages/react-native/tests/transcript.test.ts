// SPDX-License-Identifier: Apache-2.0
/**
 * Transcript reducer for the RN widget (src/native/transcript.ts). This is
 * a deliberate, dependency-free mirror of `@pinagent/shared`'s
 * `renderTranscript`, extended with the streaming-only ask/status rows the
 * interactive RN sheet renders. The folding rules are the contract: which
 * events produce rows, how tool_result back-annotates the preceding tool,
 * and how `pendingAsk` tracks the latest unanswered question.
 */
import { describe, expect, it } from 'vitest';
import { type AgentEvent, pendingAsk, renderTranscript } from '../src/native/transcript';

describe('renderTranscript', () => {
  it('drops init and progress events (no row of their own)', () => {
    const events: AgentEvent[] = [
      { type: 'init', sessionId: 's', model: 'm', permissionMode: 'p', apiKeySource: 'a' },
      { type: 'progress', turn: 2 },
    ];
    expect(renderTranscript(events)).toEqual([]);
  });

  it('renders trimmed text and skips whitespace-only text', () => {
    const rows = renderTranscript([
      { type: 'text', text: '  hello  ' },
      { type: 'text', text: '   ' },
    ]);
    expect(rows).toEqual([{ id: 'e0', kind: 'text', text: 'hello' }]);
  });

  it('renders a tool row and includes the summary only when present', () => {
    const rows = renderTranscript([
      { type: 'tool_use', name: 'Edit', summary: 'src/Foo.tsx' },
      { type: 'tool_use', name: 'Read', summary: '' },
    ]);
    expect(rows[0]).toEqual({ id: 'e0', kind: 'tool', text: 'Edit', detail: 'src/Foo.tsx' });
    expect(rows[1]).toEqual({ id: 'e1', kind: 'tool', text: 'Read' });
    expect(rows[1]).not.toHaveProperty('detail');
  });

  it('back-annotates the nearest preceding tool row with the result ok flag', () => {
    const rows = renderTranscript([
      { type: 'tool_use', name: 'Edit', summary: 'a' },
      { type: 'text', text: 'between' },
      { type: 'tool_result', ok: false },
    ]);
    const tool = rows.find((r) => r.kind === 'tool');
    expect(tool?.ok).toBe(false);
    // The text row in between is untouched.
    expect(rows.find((r) => r.kind === 'text')?.ok).toBeUndefined();
  });

  it('renders an ask row, joining options into detail', () => {
    const rows = renderTranscript([
      { type: 'ask_user', askId: 'q1', question: 'Which?', options: ['A', 'B'] },
    ]);
    expect(rows[0]).toEqual({ id: 'e0', kind: 'ask', text: 'Which?', detail: 'A · B' });
  });

  it('renders status_changed with and without a note', () => {
    const withNote = renderTranscript([
      {
        type: 'status_changed',
        status: 'fixed',
        note: 'done it',
        commitSha: null,
        resolvedAt: null,
      },
    ]);
    expect(withNote[0]).toEqual({ id: 'e0', kind: 'status', text: 'Resolved (fixed): done it' });
    const noNote = renderTranscript([
      { type: 'status_changed', status: 'wontfix', note: null, commitSha: null, resolvedAt: null },
    ]);
    expect(noNote[0].text).toBe('Resolved (wontfix)');
  });

  it('renders a successful result with singular/plural turns and cost', () => {
    const [row] = renderTranscript([
      { type: 'result', subtype: 'success', numTurns: 1, totalCostUsd: 0.1234, durationMs: 10 },
    ]);
    expect(row).toEqual({ id: 'e0', kind: 'result', text: 'Done · 1 turn · $0.1234', ok: true });
  });

  it('renders a non-success result as Ended and omits zero cost', () => {
    const [row] = renderTranscript([
      { type: 'result', subtype: 'error_max_turns', numTurns: 3, totalCostUsd: 0, durationMs: 10 },
    ]);
    expect(row).toEqual({
      id: 'e0',
      kind: 'result',
      text: 'Ended: error_max_turns · 3 turns',
      ok: false,
    });
  });

  it('renders an error row', () => {
    expect(renderTranscript([{ type: 'error', message: 'boom' }])).toEqual([
      { id: 'e0', kind: 'error', text: 'boom' },
    ]);
  });

  it('keeps row ids aligned to the original event index', () => {
    const rows = renderTranscript([
      { type: 'init', sessionId: 's', model: 'm', permissionMode: 'p', apiKeySource: 'a' },
      { type: 'text', text: 'first' },
    ]);
    // init is at index 0 (no row); the text row keeps its index-1 id.
    expect(rows).toEqual([{ id: 'e1', kind: 'text', text: 'first' }]);
  });
});

describe('pendingAsk', () => {
  it('returns null when there is no ask', () => {
    expect(pendingAsk([{ type: 'text', text: 'hi' }])).toBeNull();
  });

  it('returns the latest unanswered ask, defaulting options to []', () => {
    const ask = pendingAsk([
      { type: 'ask_user', askId: 'q1', question: 'First?' },
      { type: 'ask_user', askId: 'q2', question: 'Second?', options: ['x'] },
    ]);
    expect(ask).toEqual({ askId: 'q2', question: 'Second?', options: ['x'] });
  });

  it('is cleared by a terminal result', () => {
    expect(
      pendingAsk([
        { type: 'ask_user', askId: 'q1', question: 'Which?' },
        { type: 'result', subtype: 'success', numTurns: 1, totalCostUsd: 0, durationMs: 1 },
      ]),
    ).toBeNull();
  });

  it('is cleared by a terminal error', () => {
    expect(
      pendingAsk([
        { type: 'ask_user', askId: 'q1', question: 'Which?' },
        { type: 'error', message: 'boom' },
      ]),
    ).toBeNull();
  });
});
