// SPDX-License-Identifier: Apache-2.0
/**
 * End-to-end coverage of the MCP tool dispatcher (`callTool`). This is the
 * server's external contract — what a coding agent invokes — so the
 * security-critical `get_source_context` path-traversal guards get the
 * most attention, alongside the `resolve_feedback` status/worktree-state
 * transitions and the read tools.
 *
 * The DB is seeded the same way the dev-server's bus would write it:
 * migrations applied via the journal, then raw inserts. `callTool` reads
 * through the real `Storage` class against that on-disk SQLite file.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { callTool } from '../src/index';
import { Storage } from '../src/storage';

let uniqueIdx = 0;
const uniqueId = () => `${Date.now()}-${++uniqueIdx}`;

const HERE = fileURLToPath(new URL('.', import.meta.url));
const MIGRATIONS_DIR = join(HERE, '..', '..', 'db', 'drizzle');

function runMigrations(raw: DatabaseSync): void {
  const journal = JSON.parse(
    readFileSync(join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: { idx: number; when: number; tag: string }[] };
  raw.exec(
    `CREATE TABLE IF NOT EXISTS __drizzle_migrations (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       hash TEXT NOT NULL,
       created_at NUMERIC
     )`,
  );
  for (const entry of [...journal.entries].sort((a, b) => a.idx - b.idx)) {
    const sql = readFileSync(join(MIGRATIONS_DIR, `${entry.tag}.sql`), 'utf8');
    const hash = createHash('sha256').update(sql).digest('hex');
    for (const stmt of sql
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean)) {
      raw.exec(stmt);
    }
    raw
      .prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)')
      .run(hash, entry.when);
  }
}

interface SeedOpts {
  id: string;
  comment?: string;
  status?: string;
  worktreeState?: string;
  file?: string | null;
  line?: number | null;
  createdAtMs?: number;
}

function seedConversation(root: string, o: SeedOpts): void {
  const raw = new DatabaseSync(join(root, '.pinagent', 'db.sqlite'));
  raw.exec('PRAGMA foreign_keys = ON');
  const ts = o.createdAtMs ?? Date.now();
  raw
    .prepare(
      `INSERT INTO conversations (id, comment, status, worktree_state, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(o.id, o.comment ?? 'a comment', o.status ?? 'pending', o.worktreeState ?? 'none', ts, ts);
  raw
    .prepare(
      `INSERT INTO widget_anchors (conversation_id, url, file, line, col, selector)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(o.id, 'http://localhost:3000/', o.file ?? null, o.line ?? null, null, 'div');
  raw.close();
}

let root: string;

beforeEach(async () => {
  root = join(tmpdir(), `mcp-calltool-${uniqueId()}`);
  await mkdir(join(root, '.pinagent'), { recursive: true });
  const raw = new DatabaseSync(join(root, '.pinagent', 'db.sqlite'));
  raw.exec('PRAGMA journal_mode = WAL');
  raw.exec('PRAGMA foreign_keys = ON');
  runMigrations(raw);
  raw.close();
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const textOf = (res: Awaited<ReturnType<typeof callTool>>): string => {
  const block = res.content.find((c) => c.type === 'text');
  return block && 'text' in block ? block.text : '';
};

describe('callTool: unknown / invalid input', () => {
  it('returns an error result for an unknown tool', async () => {
    const res = await callTool(new Storage(root), root, 'does_not_exist', {});
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain('unknown tool');
  });

  it('returns an error result (not a throw) when zod validation fails', async () => {
    // get_source_context requires file + line; line:0 violates min(1).
    const res = await callTool(new Storage(root), root, 'get_source_context', {
      file: 'a.ts',
      line: 0,
    });
    expect(res.isError).toBe(true);
  });
});

describe('callTool: get_source_context path-traversal guards', () => {
  it('rejects a path containing ".."', async () => {
    const res = await callTool(new Storage(root), root, 'get_source_context', {
      file: '../../etc/passwd',
      line: 1,
    });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain('path traversal not allowed');
  });

  it('rejects an absolute path outside the project root', async () => {
    const res = await callTool(new Storage(root), root, 'get_source_context', {
      file: '/etc/hosts',
      line: 1,
    });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain('outside project root');
  });

  it('returns a read error for a missing in-root file', async () => {
    const res = await callTool(new Storage(root), root, 'get_source_context', {
      file: 'src/Nope.tsx',
      line: 1,
    });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain('cannot read');
  });
});

describe('callTool: get_source_context windowing', () => {
  beforeEach(async () => {
    await mkdir(join(root, 'src'), { recursive: true });
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n');
    await writeFile(join(root, 'src', 'File.tsx'), lines, 'utf8');
  });

  it('returns a clamped window with a marker on the target line', async () => {
    const res = await callTool(new Storage(root), root, 'get_source_context', {
      file: 'src/File.tsx',
      line: 5,
      radius: 2,
    });
    expect(res.isError).toBeUndefined();
    const text = textOf(res);
    expect(text).toContain('lines 3-7, target 5');
    // The target line is prefixed with '>'; neighbors with a space.
    expect(text).toMatch(/>\s+5 \| line 5/);
    expect(text).toMatch(/\s{2}4 \| line 4/);
    // Outside the radius is excluded.
    expect(text).not.toContain('line 8');
  });

  it('clamps the window to the start of the file (no negative lines)', async () => {
    const res = await callTool(new Storage(root), root, 'get_source_context', {
      file: 'src/File.tsx',
      line: 1,
      radius: 10,
    });
    expect(textOf(res)).toContain('lines 1-11, target 1');
  });
});

describe('callTool: list_pending_feedback', () => {
  it('lists only pending items and honors the file + since filters', async () => {
    seedConversation(root, {
      id: 'cv_pendingA',
      file: 'src/Header.tsx',
      createdAtMs: 1_000,
    });
    seedConversation(root, {
      id: 'cv_pendingB',
      file: 'src/Footer.tsx',
      createdAtMs: 5_000,
    });
    seedConversation(root, { id: 'cv_fixedC', status: 'fixed', file: 'src/Header.tsx' });

    const all = await callTool(new Storage(root), root, 'list_pending_feedback', {});
    const allIds = JSON.parse(textOf(all)).items.map((i: { id: string }) => i.id);
    expect(allIds).toEqual(expect.arrayContaining(['cv_pendingA', 'cv_pendingB']));
    expect(allIds).not.toContain('cv_fixedC');

    const byFile = await callTool(new Storage(root), root, 'list_pending_feedback', {
      file: 'Header',
    });
    expect(JSON.parse(textOf(byFile)).items.map((i: { id: string }) => i.id)).toEqual([
      'cv_pendingA',
    ]);

    const since = await callTool(new Storage(root), root, 'list_pending_feedback', {
      since: new Date(2_000).toISOString(),
    });
    expect(JSON.parse(textOf(since)).items.map((i: { id: string }) => i.id)).toEqual([
      'cv_pendingB',
    ]);
  });
});

describe('callTool: get_feedback', () => {
  it('errors when the id is unknown', async () => {
    const res = await callTool(new Storage(root), root, 'get_feedback', { id: 'cv_missing1' });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain('not found');
  });

  it('returns a formatted record (text only) when no screenshot exists', async () => {
    seedConversation(root, {
      id: 'cv_getfb01',
      comment: 'fix the title',
      file: 'src/X.tsx',
      line: 9,
    });
    const res = await callTool(new Storage(root), root, 'get_feedback', { id: 'cv_getfb01' });
    expect(res.isError).toBeUndefined();
    expect(textOf(res)).toContain('fix the title');
    expect(textOf(res)).toContain('target: src/X.tsx:9');
    expect(res.content.some((c) => c.type === 'image')).toBe(false);
  });
});

describe('callTool: resolve_feedback', () => {
  it('marks an inline-mode (worktreeState none) item fixed -> landed and sets resolvedAt', async () => {
    seedConversation(root, { id: 'cv_resolve1' });
    const res = await callTool(new Storage(root), root, 'resolve_feedback', {
      id: 'cv_resolve1',
      status: 'fixed',
      note: 'done',
      commit_sha: 'abc123',
    });
    expect(JSON.parse(textOf(res))).toMatchObject({ ok: true, status: 'fixed' });

    const rec = await new Storage(root).read('cv_resolve1');
    expect(rec?.status).toBe('fixed');
    expect(rec?.worktreeState).toBe('landed');
    expect(rec?.note).toBe('done');
    expect(rec?.commitSha).toBe('abc123');
    expect(rec?.resolvedAt).not.toBeNull();
  });

  it('maps wontfix to a discarded worktree state for inline-mode items', async () => {
    seedConversation(root, { id: 'cv_resolve2' });
    await callTool(new Storage(root), root, 'resolve_feedback', {
      id: 'cv_resolve2',
      status: 'wontfix',
    });
    const rec = await new Storage(root).read('cv_resolve2');
    expect(rec?.worktreeState).toBe('discarded');
  });

  it('leaves a real (active) worktree state untouched — user still lands/discards', async () => {
    seedConversation(root, { id: 'cv_resolve3', worktreeState: 'active' });
    await callTool(new Storage(root), root, 'resolve_feedback', {
      id: 'cv_resolve3',
      status: 'fixed',
    });
    const rec = await new Storage(root).read('cv_resolve3');
    expect(rec?.status).toBe('fixed');
    expect(rec?.worktreeState).toBe('active');
  });

  it('reopening to pending clears resolvedAt', async () => {
    seedConversation(root, { id: 'cv_resolve4' });
    await callTool(new Storage(root), root, 'resolve_feedback', {
      id: 'cv_resolve4',
      status: 'fixed',
    });
    await callTool(new Storage(root), root, 'resolve_feedback', {
      id: 'cv_resolve4',
      status: 'pending',
    });
    const rec = await new Storage(root).read('cv_resolve4');
    expect(rec?.status).toBe('pending');
    expect(rec?.resolvedAt).toBeNull();
  });

  it('errors on an unknown id', async () => {
    const res = await callTool(new Storage(root), root, 'resolve_feedback', {
      id: 'cv_nope000',
      status: 'fixed',
    });
    expect(res.isError).toBe(true);
  });
});

describe('callTool: get_conversation_transcript', () => {
  function seedMessages(convId: string): void {
    seedConversation(root, { id: convId });
    const raw = new DatabaseSync(join(root, '.pinagent', 'db.sqlite'));
    const insert = raw.prepare(
      'INSERT INTO messages (conversation_id, turn, role, content) VALUES (?, 1, ?, ?)',
    );
    insert.run(convId, 'text', JSON.stringify({ type: 'text', text: 'hello' }));
    insert.run(convId, 'text', JSON.stringify({ type: 'text', text: 'world' }));
    raw.close();
  }

  it('renders text by default', async () => {
    seedMessages('cv_trans001');
    const res = await callTool(new Storage(root), root, 'get_conversation_transcript', {
      id: 'cv_trans001',
    });
    expect(res.isError).toBeUndefined();
    expect(textOf(res)).toContain('hello');
    expect(textOf(res)).toContain('world');
  });

  it('returns raw JSON events when format=json', async () => {
    seedMessages('cv_trans002');
    const res = await callTool(new Storage(root), root, 'get_conversation_transcript', {
      id: 'cv_trans002',
      format: 'json',
    });
    const parsed = JSON.parse(textOf(res));
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({ type: 'text', text: 'hello' });
  });

  it('errors on an unknown conversation id', async () => {
    const res = await callTool(new Storage(root), root, 'get_conversation_transcript', {
      id: 'cv_unknown9',
    });
    expect(res.isError).toBe(true);
  });
});
