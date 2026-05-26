// SPDX-License-Identifier: Apache-2.0
// SQLite-backed mirror of @pinagent/next/src/storage.ts. The MCP
// server runs in a separate Node process from the dev server but
// opens the same `.pinagent/db.sqlite` file (SQLite WAL mode handles
// concurrent readers/writers across processes).
//
// Screenshots stay on disk under `.pinagent/screenshots/<id>.png`.
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { asc, conversations, eq, widgetAnchors } from '@pinagent/db';
import * as schema from '@pinagent/db/schema';
import Database from 'better-sqlite3';
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3';
import { z } from 'zod';

export const ID_RE = /^[A-Za-z0-9_-]{8,16}$/;

export const StatusSchema = z.enum(['pending', 'fixed', 'wontfix', 'deferred']);
export type Status = z.infer<typeof StatusSchema>;

export interface FeedbackRecord {
  id: string;
  comment: string;
  file: string | null;
  line: number | null;
  col: number | null;
  selector: string;
  url: string;
  viewport: { w: number; h: number };
  userAgent: string;
  screenshot: string;
  status: Status;
  note: string | null;
  commitSha: string | null;
  agentSessionId: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

type Db = BetterSQLite3Database<typeof schema>;

export class Storage {
  readonly root: string;
  /**
   * Legacy directory we still expose for the channel watcher path
   * comparison and any consumer that scans it. The new source of
   * truth is SQLite, but `.pinagent/feedback/` may still contain
   * pre-migration JSON files which the import step folds in.
   */
  readonly feedbackDir: string;
  private dbHandle: Db | null = null;
  private legacyImportDone = false;

  constructor(root: string) {
    this.root = root;
    this.feedbackDir = join(root, '.pinagent', 'feedback');
  }

  private db(): Db {
    if (this.dbHandle) return this.dbHandle;
    const dbPath = join(this.root, '.pinagent', 'db.sqlite');
    const raw = new Database(dbPath, { fileMustExist: false });
    raw.pragma('journal_mode = WAL');
    raw.pragma('foreign_keys = ON');
    // The route process owns migrations. MCP may start before the
    // route, in which case the DB file might not have the schema yet.
    // We only READ + occasionally UPDATE, and the route applies
    // migrations on its first connect — but if MCP is alone in the
    // wild (no dev server yet), we won't have tables. That's fine:
    // queries return empty results until the route runs.
    this.dbHandle = drizzle(raw, { schema });
    return this.dbHandle;
  }

  private async maybeImportLegacy(): Promise<void> {
    if (this.legacyImportDone) return;
    this.legacyImportDone = true;
    if (!existsSync(this.feedbackDir)) return;
    try {
      const names = await readdir(this.feedbackDir);
      const db = this.db();
      for (const n of names) {
        if (!n.endsWith('.json') || n.endsWith('.tmp')) continue;
        const id = n.slice(0, -'.json'.length);
        if (!ID_RE.test(id)) continue;
        try {
          const raw = await readFile(join(this.feedbackDir, n), 'utf8');
          const rec = JSON.parse(raw) as Partial<FeedbackRecord>;
          if (!rec.id || !rec.comment) continue;
          await db
            .insert(conversations)
            .values({
              id: rec.id,
              comment: rec.comment,
              agentSessionId: rec.agentSessionId ?? null,
              status: rec.status ?? 'pending',
              note: rec.note ?? null,
              commitSha: rec.commitSha ?? null,
              createdAt: parseDate(rec.createdAt ?? new Date().toISOString()),
              updatedAt: parseDate(rec.createdAt ?? new Date().toISOString()),
              resolvedAt: rec.resolvedAt ? parseDate(rec.resolvedAt) : null,
            })
            .onConflictDoNothing();
          await db
            .insert(widgetAnchors)
            .values({
              conversationId: rec.id,
              url: rec.url ?? '',
              file: rec.file ?? null,
              line: rec.line ?? null,
              col: rec.col ?? null,
              selector: rec.selector ?? '',
              viewportW: rec.viewport?.w ?? null,
              viewportH: rec.viewport?.h ?? null,
              userAgent: rec.userAgent ?? null,
            })
            .onConflictDoNothing();
        } catch {
          // Skip malformed; original stays on disk.
        }
      }
    } catch {
      // No feedback dir / permission issue — not fatal.
    }
  }

  async list(): Promise<FeedbackRecord[]> {
    await this.maybeImportLegacy();
    try {
      const rows = await this.db()
        .select()
        .from(conversations)
        .leftJoin(widgetAnchors, eq(conversations.id, widgetAnchors.conversationId))
        .orderBy(asc(conversations.createdAt));
      return rows.map(rowToRecord);
    } catch {
      // Schema might not be applied yet (MCP started before route).
      return [];
    }
  }

  async read(id: string): Promise<FeedbackRecord | null> {
    if (!ID_RE.test(id)) return null;
    await this.maybeImportLegacy();
    try {
      const rows = await this.db()
        .select()
        .from(conversations)
        .leftJoin(widgetAnchors, eq(conversations.id, widgetAnchors.conversationId))
        .where(eq(conversations.id, id))
        .limit(1);
      const row = rows[0];
      if (!row) return null;
      return rowToRecord(row);
    } catch {
      return null;
    }
  }

  async readScreenshot(rec: FeedbackRecord): Promise<Buffer | null> {
    const abs = join(this.root, '.pinagent', rec.screenshot);
    if (!existsSync(abs)) return null;
    return readFile(abs);
  }

  /**
   * Write back a (potentially-mutated) record. The MCP `resolve_feedback`
   * tool uses this. We only touch the `conversations` columns that can
   * change at runtime — anchor data is immutable after creation.
   */
  async write(rec: FeedbackRecord): Promise<void> {
    const db = this.db();
    await db
      .update(conversations)
      .set({
        status: rec.status,
        note: rec.note,
        commitSha: rec.commitSha,
        agentSessionId: rec.agentSessionId,
        updatedAt: new Date(),
        resolvedAt: rec.resolvedAt ? parseDate(rec.resolvedAt) : null,
      })
      .where(eq(conversations.id, rec.id));
  }
}

function parseDate(iso: string): Date {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return new Date();
  return d;
}

function rowToRecord(row: {
  conversations: typeof conversations.$inferSelect;
  widget_anchors: typeof widgetAnchors.$inferSelect | null;
}): FeedbackRecord {
  const c = row.conversations;
  const a = row.widget_anchors;
  return {
    id: c.id,
    comment: c.comment,
    file: a?.file ?? null,
    line: a?.line ?? null,
    col: a?.col ?? null,
    selector: a?.selector ?? '',
    url: a?.url ?? '',
    viewport: { w: a?.viewportW ?? 0, h: a?.viewportH ?? 0 },
    userAgent: a?.userAgent ?? '',
    screenshot: join('screenshots', `${c.id}.png`),
    status: c.status,
    note: c.note,
    commitSha: c.commitSha,
    agentSessionId: c.agentSessionId,
    createdAt: c.createdAt.toISOString(),
    resolvedAt: c.resolvedAt ? c.resolvedAt.toISOString() : null,
  };
}

export function isInsideRoot(root: string, target: string): boolean {
  const r = resolve(root);
  const t = resolve(target);
  const rel = relative(r, t);
  return !rel.startsWith('..') && rel !== '..' && !rel.startsWith(`..${'/'}`);
}
