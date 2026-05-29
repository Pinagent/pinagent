// SPDX-License-Identifier: Apache-2.0
/**
 * Unit tests for the pure pieces of `pinagent list` and `pinagent
 * resolve`: the argv parsers, the client-side filter, and the table
 * renderer. The HTTP fetch/patch is exercised by the e2e test against
 * the real vite-plugin middleware.
 */
import { describe, expect, it } from 'vitest';
import {
  type FeedbackRow,
  filterFeedback,
  type ListArgs,
  parseListArgs,
  parseResolveArgs,
  renderFeedbackList,
  renderResolveResult,
} from '../src/feedback';

const DEFAULT_URL = process.env.PINAGENT_SERVER_URL ?? 'http://localhost:3000';

describe('parseListArgs', () => {
  it('defaults to no filters and the default server url', () => {
    expect(parseListArgs([], {})).toEqual({
      serverUrl: 'http://localhost:3000',
      status: null,
      file: null,
      all: false,
      json: false,
    });
  });

  it('parses --status, --file, --all, --json, and --server', () => {
    expect(
      parseListArgs(
        ['--status', 'fixed', '--file', 'src/Foo', '--all', '--json', '--server', 'http://x:1'],
        {},
      ),
    ).toEqual({
      serverUrl: 'http://x:1',
      status: 'fixed',
      file: 'src/Foo',
      all: true,
      json: true,
    });
  });

  it('rejects an unknown --status value', () => {
    expect(parseListArgs(['--status', 'nope'], {})).toEqual({
      error: 'invalid --status "nope" (expected pending | fixed | wontfix | deferred)',
    });
  });

  it('rejects --status without a value', () => {
    expect(parseListArgs(['--status'], {})).toEqual({ error: '--status requires a value' });
  });

  it('rejects unknown flags', () => {
    expect(parseListArgs(['--weird'], {})).toEqual({ error: 'unexpected argument: --weird' });
  });
});

describe('filterFeedback', () => {
  const base: ListArgs = {
    serverUrl: DEFAULT_URL,
    status: null,
    file: null,
    all: false,
    json: false,
  };
  const rows: FeedbackRow[] = [
    { id: 'aaaaaaaa', status: 'pending', file: 'src/Foo.tsx', archived: false },
    { id: 'bbbbbbbb', status: 'fixed', file: 'src/Bar.tsx', archived: false },
    { id: 'cccccccc', status: 'fixed', file: 'src/Baz.tsx', archived: true },
  ];

  it('hides archived rows by default', () => {
    expect(filterFeedback(rows, base).map((r) => r.id)).toEqual(['aaaaaaaa', 'bbbbbbbb']);
  });

  it('includes archived rows when all=true', () => {
    expect(filterFeedback(rows, { ...base, all: true }).map((r) => r.id)).toEqual([
      'aaaaaaaa',
      'bbbbbbbb',
      'cccccccc',
    ]);
  });

  it('filters by status', () => {
    expect(filterFeedback(rows, { ...base, status: 'fixed' }).map((r) => r.id)).toEqual([
      'bbbbbbbb',
    ]);
  });

  it('filters by file substring', () => {
    expect(filterFeedback(rows, { ...base, file: 'Foo' }).map((r) => r.id)).toEqual(['aaaaaaaa']);
  });
});

describe('renderFeedbackList', () => {
  it('returns a friendly marker for an empty list', () => {
    expect(renderFeedbackList([])).toBe('No feedback found.\n');
  });

  it('renders an aligned table with a header and a count footer', () => {
    const out = renderFeedbackList([
      { id: 'aaaaaaaa', status: 'pending', file: 'src/Foo.tsx', line: 42, comment: 'Tweak this' },
    ]);
    expect(out).toContain('ID');
    expect(out).toContain('STATUS');
    expect(out).toContain('LOCATION');
    expect(out).toContain('COMMENT');
    expect(out).toContain('aaaaaaaa');
    expect(out).toContain('src/Foo.tsx:42');
    expect(out).toContain('Tweak this');
    expect(out.trimEnd().endsWith('1 item(s).')).toBe(true);
  });

  it('prefers the title and uses only the first comment line', () => {
    const out = renderFeedbackList([
      { id: 'bbbbbbbb', status: 'fixed', title: 'Nice title', comment: 'line1\nline2' },
    ]);
    expect(out).toContain('Nice title');
    expect(out).not.toContain('line2');
  });

  it('shows a dash for rows with no file', () => {
    const out = renderFeedbackList([{ id: 'cccccccc', status: 'pending', comment: 'no loc' }]);
    expect(out).toContain('—');
  });
});

describe('parseResolveArgs', () => {
  it('parses id + required --status with optional note/commit', () => {
    expect(
      parseResolveArgs(
        ['cv_abc123', '--status', 'fixed', '--note', 'done', '--commit', 'a1b2c3'],
        {},
      ),
    ).toEqual({
      id: 'cv_abc123',
      status: 'fixed',
      note: 'done',
      commitSha: 'a1b2c3',
      serverUrl: 'http://localhost:3000',
      json: false,
    });
  });

  it('allows re-opening with --status pending', () => {
    expect(parseResolveArgs(['cv_abc123', '--status', 'pending'], {})).toMatchObject({
      status: 'pending',
    });
  });

  it('rejects a missing id', () => {
    expect(parseResolveArgs(['--status', 'fixed'], {})).toEqual({
      error: 'missing required <id> argument',
    });
  });

  it('rejects an invalid id', () => {
    expect(parseResolveArgs(['!!', '--status', 'fixed'], {})).toEqual({ error: 'invalid id "!!"' });
  });

  it('rejects a missing --status', () => {
    expect(parseResolveArgs(['cv_abc123'], {})).toEqual({
      error: 'missing required --status <pending|fixed|wontfix|deferred>',
    });
  });

  it('rejects an invalid --status value', () => {
    expect(parseResolveArgs(['cv_abc123', '--status', 'closed'], {})).toEqual({
      error: 'invalid --status "closed" (expected pending | fixed | wontfix | deferred)',
    });
  });

  it('accepts an empty --note value', () => {
    expect(parseResolveArgs(['cv_abc123', '--status', 'fixed', '--note', ''], {})).toMatchObject({
      note: '',
    });
  });
});

describe('renderResolveResult', () => {
  it('confirms the new status with the location when present', () => {
    expect(
      renderResolveResult({ id: 'cv_abc123', status: 'fixed', file: 'src/Foo.tsx', line: 9 }),
    ).toBe('✓ cv_abc123 → fixed (src/Foo.tsx:9)\n');
  });

  it('omits the location when there is no file', () => {
    expect(renderResolveResult({ id: 'cv_abc123', status: 'wontfix' })).toBe(
      '✓ cv_abc123 → wontfix\n',
    );
  });
});
