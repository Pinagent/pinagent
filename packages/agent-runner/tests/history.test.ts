// SPDX-License-Identifier: Apache-2.0
/**
 * `searchHistory` — LIKE search over resolved conversations, the
 * matched-field detection, status filtering, and snippet extraction.
 * Only "resolved" rows (landed / discarded / wontfix) are eligible; an
 * active or pending row must never surface even when it matches the
 * query.
 */
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { conversations, widgetAnchors } from '@pinagent/db';
import { nanoid } from 'nanoid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

type HistoryMod = typeof import('../src/history');
type ClientMod = typeof import('../src/db/client');

let history: HistoryMod;
let getDb: ClientMod['getDb'];

const PARENT = join(tmpdir(), `pa-history-${nanoid(8)}`);

interface SeedRow {
  id: string;
  comment: string;
  status?: 'pending' | 'fixed' | 'wontfix' | 'deferred';
  worktreeState?: 'none' | 'active' | 'landed' | 'discarded';
  branch?: string | null;
  note?: string | null;
  file?: string | null;
  selector?: string;
}

async function seed(root: string, rows: SeedRow[]): Promise<void> {
  const db = getDb(root);
  for (const r of rows) {
    await db.insert(conversations).values({
      id: r.id,
      comment: r.comment,
      status: r.status ?? 'fixed',
      worktreeState: r.worktreeState ?? 'landed',
      branch: r.branch ?? null,
      note: r.note ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.insert(widgetAnchors).values({
      conversationId: r.id,
      url: 'http://localhost:3000/',
      file: r.file ?? null,
      selector: r.selector ?? 'div',
    });
  }
}

async function freshRoot(): Promise<string> {
  const root = join(PARENT, nanoid(8));
  await mkdir(root, { recursive: true });
  return root;
}

beforeAll(async () => {
  process.env.NODE_ENV = 'production';
  await mkdir(PARENT, { recursive: true });
  history = await import('../src/history');
  ({ getDb } = await import('../src/db/client'));
});

afterAll(async () => {
  await rm(PARENT, { recursive: true, force: true });
});

describe('searchHistory', () => {
  it('returns [] for an empty / whitespace query without touching the DB', async () => {
    const root = await freshRoot();
    expect(await history.searchHistory(root, { query: '' })).toEqual([]);
    expect(await history.searchHistory(root, { query: '   ' })).toEqual([]);
  });

  it('matches the comment and flags the matched field + snippet', async () => {
    const root = await freshRoot();
    await seed(root, [
      { id: 'cv_h1', comment: 'Please rename the Potato counter to Apple' },
      { id: 'cv_h2', comment: 'unrelated change' },
    ]);
    const hits = await history.searchHistory(root, { query: 'potato' });
    expect(hits.map((h) => h.id)).toEqual(['cv_h1']);
    expect(hits[0]?.matchedFields).toContain('comment');
    expect(hits[0]?.snippet.toLowerCase()).toContain('potato');
  });

  it('matches the anchor file and reports the "anchor" field', async () => {
    const root = await freshRoot();
    await seed(root, [{ id: 'cv_h3', comment: 'tweak header', file: 'src/Header.tsx' }]);
    const hits = await history.searchHistory(root, { query: 'Header.tsx' });
    expect(hits.map((h) => h.id)).toEqual(['cv_h3']);
    expect(hits[0]?.matchedFields).toContain('anchor');
    // No comment match -> empty snippet.
    expect(hits[0]?.snippet).toBe('');
  });

  it('excludes pending / active conversations even when they match', async () => {
    const root = await freshRoot();
    await seed(root, [
      { id: 'cv_active', comment: 'matchme active', worktreeState: 'active', status: 'pending' },
      { id: 'cv_landed', comment: 'matchme landed', worktreeState: 'landed', status: 'fixed' },
    ]);
    const hits = await history.searchHistory(root, { query: 'matchme' });
    expect(hits.map((h) => h.id)).toEqual(['cv_landed']);
  });

  it('treats a wontfix (worktreeState none) row as resolved under the "all" filter', async () => {
    const root = await freshRoot();
    await seed(root, [
      { id: 'cv_wf', comment: 'cannot do widget', status: 'wontfix', worktreeState: 'none' },
    ]);
    const hits = await history.searchHistory(root, { query: 'widget' });
    expect(hits.map((h) => h.id)).toEqual(['cv_wf']);
  });

  it('narrows to landed-only with status="landed"', async () => {
    const root = await freshRoot();
    await seed(root, [
      { id: 'cv_l', comment: 'shared keyword', worktreeState: 'landed', status: 'fixed' },
      { id: 'cv_d', comment: 'shared keyword', worktreeState: 'discarded', status: 'fixed' },
    ]);
    const landed = await history.searchHistory(root, { query: 'shared', status: 'landed' });
    expect(landed.map((h) => h.id)).toEqual(['cv_l']);
  });

  it('matches against the branch column', async () => {
    const root = await freshRoot();
    await seed(root, [{ id: 'cv_b', comment: 'whatever', branch: 'pinagent/cv_special' }]);
    const hits = await history.searchHistory(root, { query: 'cv_special' });
    expect(hits.map((h) => h.id)).toEqual(['cv_b']);
    expect(hits[0]?.matchedFields).toContain('branch');
  });

  it('honors the result limit', async () => {
    const root = await freshRoot();
    await seed(
      root,
      Array.from({ length: 5 }, (_, i) => ({ id: `cv_lim${i}`, comment: `dup keyword ${i}` })),
    );
    const hits = await history.searchHistory(root, { query: 'keyword', limit: 3 });
    expect(hits).toHaveLength(3);
  });
});
