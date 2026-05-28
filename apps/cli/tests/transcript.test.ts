// SPDX-License-Identifier: Apache-2.0
/**
 * Unit tests for the `pinagent transcript` subcommand's pure pieces:
 * the renderer and the argv parser. The HTTP fetch is not exercised
 * here — it would require standing up a server, and the
 * vite-plugin/next-plugin route tests already pin the wire shape.
 */
import type { AgentEvent } from '@pinagent/shared';
import { describe, expect, it } from 'vitest';
import { parseTranscriptArgs, renderTranscript } from '../src/transcript';

describe('renderTranscript', () => {
  it('returns a (no events recorded) marker for an empty array', () => {
    expect(renderTranscript([])).toBe('(no events recorded)\n');
  });

  it('renders init with session id, model, mode, and key source', () => {
    const out = renderTranscript([
      {
        type: 'init',
        sessionId: 'sess-abc',
        model: 'claude-opus-4-7',
        permissionMode: 'acceptEdits',
        apiKeySource: 'oauth',
      },
    ]);
    expect(out).toContain('[init] sess-abc · claude-opus-4-7 · acceptEdits (oauth)');
  });

  it('prefixes each text line with `> ` so multi-line agent replies stay readable', () => {
    const out = renderTranscript([{ type: 'text', text: 'first line\nsecond line' }]);
    expect(out).toContain('> first line\n> second line');
  });

  it('renders tool_use with name + summary', () => {
    const out = renderTranscript([{ type: 'tool_use', name: 'Edit', summary: 'src/Foo.tsx' }]);
    expect(out).toContain('[tool_use] Edit · src/Foo.tsx');
  });

  it('renders tool_result.ok=false as `error`', () => {
    const out = renderTranscript([{ type: 'tool_result', ok: false }]);
    expect(out).toContain('[tool_result] error');
  });

  it('renders ask_user with options on one line and context on the next', () => {
    const out = renderTranscript([
      {
        type: 'ask_user',
        askId: 'ask-1',
        question: 'Which tier?',
        options: ['Pro', 'Business'],
        context: 'Pricing grid is currently neutral.',
      },
    ]);
    expect(out).toContain('[ask_user] Which tier? · options: Pro | Business');
    expect(out).toContain('  Pricing grid is currently neutral.');
  });

  it('renders result with cost in $ and duration in seconds', () => {
    const out = renderTranscript([
      {
        type: 'result',
        subtype: 'success',
        numTurns: 4,
        totalCostUsd: 0.012,
        durationMs: 8_400,
      },
    ]);
    expect(out).toContain('[result] success · 4 turn(s) · $0.0120 · 8.40s');
  });

  it('renders status_changed with a short commit sha when present', () => {
    const out = renderTranscript([
      {
        type: 'status_changed',
        status: 'fixed',
        note: 'Landed.',
        commitSha: 'a91f3c5e0abcdef1234',
        resolvedAt: '2026-05-25T18:00:00.000Z',
      },
    ]);
    expect(out).toContain('[status_changed] fixed (a91f3c5e) · Landed.');
  });

  it('joins events with a blank line between them', () => {
    const events: AgentEvent[] = [
      { type: 'text', text: 'hello' },
      { type: 'text', text: 'world' },
    ];
    expect(renderTranscript(events)).toBe('> hello\n\n> world\n');
  });
});

describe('parseTranscriptArgs', () => {
  it('parses a bare id with default server url + plain output', () => {
    const result = parseTranscriptArgs(['cv_01']);
    expect(result).toEqual({
      id: 'cv_01',
      serverUrl: process.env.PINAGENT_SERVER_URL ?? 'http://localhost:3000',
      json: false,
    });
  });

  it('accepts --json and --server', () => {
    const result = parseTranscriptArgs(['--server', 'http://localhost:5173', '--json', 'cv_42']);
    expect(result).toEqual({
      id: 'cv_42',
      serverUrl: 'http://localhost:5173',
      json: true,
    });
  });

  it('accepts -s as a short alias for --server', () => {
    const result = parseTranscriptArgs(['-s', 'http://1.2.3.4:80', 'cv_99']);
    expect(result).toMatchObject({ serverUrl: 'http://1.2.3.4:80', id: 'cv_99' });
  });

  it('rejects --server without a value', () => {
    expect(parseTranscriptArgs(['--server'])).toEqual({ error: '--server requires a value' });
  });

  it('rejects --server when the value looks like another flag', () => {
    expect(parseTranscriptArgs(['--server', '--json', 'cv_01'])).toEqual({
      error: '--server requires a value',
    });
  });

  it('rejects missing id', () => {
    expect(parseTranscriptArgs(['--json'])).toEqual({ error: 'missing required <id> argument' });
  });

  it('rejects unknown flags', () => {
    expect(parseTranscriptArgs(['--weird', 'cv_01'])).toEqual({
      error: 'unexpected argument: --weird',
    });
  });
});
