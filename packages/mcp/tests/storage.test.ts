// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for the MCP package's `Storage.recordAuditEvent` helper. The
 * MCP server uses this so the dock's History → Activity tab shows
 * agent-driven resolutions alongside the human-driven land/discard
 * events — both ultimately land in the same `audit_events` table that
 * agent-runner's `listAuditEvents` reads from.
 *
 * Schema compatibility is the load-bearing assertion: a row written by
 * MCP must be readable by the dev-server side with the same column
 * names and types.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { auditEvents, conversations, widgetAnchors } from '@pinagent/db';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Storage } from '../src/storage';

let uniqueIdx = 0;
const uniqueId = () => `${Date.now()}-${++uniqueIdx}`;

const HERE = fileURLToPath(new URL('.', import.meta.url));
const MIGRATIONS_DIR = join(HERE, '..', '..', 'db', 'drizzle');

/**
 * Inline drizzle-style migration runner. Mirrors what
 * `@pinagent/agent-runner`'s `applyMigrations` does — the agent-runner
 * helper isn't re-exported on the public surface, and pulling in a
 * dependency on agent-runner here would invert the package graph.
 */
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

let root: string;

beforeEach(async () => {
  root = join(tmpdir(), `mcp-storage-${uniqueId()}`);
  await mkdir(join(root, '.pinagent'), { recursive: true });
  // Apply migrations so the `audit_events` and `conversations` tables
  // exist — the MCP server normally relies on the dev-server having
  // already run migrations at first connect.
  const raw = new DatabaseSync(join(root, '.pinagent', 'db.sqlite'));
  raw.exec('PRAGMA journal_mode = WAL');
  raw.exec('PRAGMA foreign_keys = ON');
  runMigrations(raw);
  raw.close();
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('Storage.recordAuditEvent', () => {
  it('writes a row that downstream readers can parse', async () => {
    const storage = new Storage(root);
    await storage.recordAuditEvent({
      conversationId: 'abc12345',
      actor: 'agent',
      action: 'conversation_resolved_by_agent',
      payload: {
        status: 'fixed',
        previousStatus: 'pending',
        worktreeState: 'landed',
        previousWorktreeState: 'none',
      },
    });

    // Read back via raw drizzle (avoids depending on agent-runner's
    // listAuditEvents — the cross-package read pattern is the point of
    // this test, not the test wrapper).
    const raw = new DatabaseSync(join(root, '.pinagent', 'db.sqlite'));
    const db = drizzle(
      async (sql, params, method) => {
        const stmt = raw.prepare(sql);
        if (method === 'run') {
          const info = stmt.run(...(params as (string | number | bigint | Uint8Array | null)[]));
          return {
            rows: [{ changes: Number(info.changes), lastInsertRowid: info.lastInsertRowid }],
          };
        }
        const rows = stmt.all(
          ...(params as (string | number | bigint | Uint8Array | null)[]),
        ) as Record<string, unknown>[];
        const columns = stmt.columns().map((c) => c.column ?? c.name);
        const projected = rows.map((r) => columns.map((c) => r[c as string] ?? null));
        if (method === 'get') return { rows: projected[0] ?? [] };
        return { rows: projected };
      },
      { schema: { auditEvents, conversations, widgetAnchors } },
    );

    const rows = await db.select().from(auditEvents);
    raw.close();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      conversationId: 'abc12345',
      actor: 'agent',
      action: 'conversation_resolved_by_agent',
      payload: {
        status: 'fixed',
        previousStatus: 'pending',
        worktreeState: 'landed',
        previousWorktreeState: 'none',
      },
    });
  });

  it('swallows DB errors instead of throwing into the caller', async () => {
    // No migrations on this root, so the audit_events table doesn't exist.
    const freshRoot = join(tmpdir(), `mcp-noaud-${uniqueId()}`);
    await mkdir(join(freshRoot, '.pinagent'), { recursive: true });
    const storage = new Storage(freshRoot);
    // Must not throw — resolve_feedback's success can't be undone by an
    // audit-log write failure.
    await expect(
      storage.recordAuditEvent({
        conversationId: null,
        actor: 'agent',
        action: 'conversation_resolved_by_agent',
        payload: {},
      }),
    ).resolves.toBeUndefined();
    await rm(freshRoot, { recursive: true, force: true });
  });
});
