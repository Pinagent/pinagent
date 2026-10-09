// SPDX-License-Identifier: Apache-2.0
/**
 * Test helpers that build a real `.pinagent/db.sqlite` the way the dev
 * server would: drizzle migrations applied from the journal, then raw
 * inserts. Shared by the multi-root suites, which need several project
 * roots each with its own DB.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const MIGRATIONS_DIR = join(HERE, '..', '..', '..', 'db', 'drizzle');

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

/** Create `<root>/.pinagent/db.sqlite` with the current schema. */
export async function initProjectDb(root: string): Promise<void> {
  await mkdir(join(root, '.pinagent'), { recursive: true });
  const raw = new DatabaseSync(join(root, '.pinagent', 'db.sqlite'));
  raw.exec('PRAGMA journal_mode = WAL');
  raw.exec('PRAGMA foreign_keys = ON');
  runMigrations(raw);
  raw.close();
}

export interface SeedOpts {
  id: string;
  comment?: string;
  status?: string;
  worktreeState?: string;
  file?: string | null;
  line?: number | null;
  createdAtMs?: number;
}

export function seedConversation(root: string, o: SeedOpts): void {
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

export function seedMessages(root: string, convId: string, texts: string[]): void {
  const raw = new DatabaseSync(join(root, '.pinagent', 'db.sqlite'));
  const insert = raw.prepare(
    'INSERT INTO messages (conversation_id, turn, role, content) VALUES (?, 1, ?, ?)',
  );
  for (const text of texts) insert.run(convId, 'text', JSON.stringify({ type: 'text', text }));
  raw.close();
}

/** Read one conversation's status straight from SQLite, bypassing `Storage`. */
export function readStatus(root: string, id: string): string | undefined {
  const raw = new DatabaseSync(join(root, '.pinagent', 'db.sqlite'));
  const row = raw.prepare('SELECT status FROM conversations WHERE id = ?').get(id) as
    | { status: string }
    | undefined;
  raw.close();
  return row?.status;
}
