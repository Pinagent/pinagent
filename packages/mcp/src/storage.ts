// SPDX-License-Identifier: Apache-2.0
// SQLite-backed mirror of @pinagent/next-plugin/src/storage.ts. The MCP
// server runs in a separate Node process from the dev server but
// opens the same `.pinagent/db.sqlite` file (SQLite WAL mode handles
// concurrent readers/writers across processes).
//
// Screenshots stay on disk under `.pinagent/screenshots/<id>.png`.
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  and,
  asc,
  auditEvents,
  conversations,
  eq,
  messages,
  notInArray,
  widgetAnchors,
} from '@pinagent/db';
import * as schema from '@pinagent/db/schema';
import type { AgentEvent } from '@pinagent/shared';
import { drizzle, type SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy';
import { z } from 'zod';

export const ID_RE = /^[A-Za-z0-9_-]{8,16}$/;

export const StatusSchema = z.enum(['pending', 'fixed', 'wontfix', 'deferred']);
export type Status = z.infer<typeof StatusSchema>;

export type WorktreeState = 'none' | 'active' | 'landed' | 'discarded';

export interface AdditionalAnchor {
  file: string | null;
  line: number | null;
  col: number | null;
  selector: string;
  clickX: number;
  clickY: number;
}

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
  /**
   * Cmd/Ctrl-click extras the user accumulated before the committing
   * click, in order. Null in the common single-pick case. v1 just
   * surfaces them — the MCP agent prompt doesn't yet enumerate them.
   */
  additionalAnchors: AdditionalAnchor[] | null;
  /** Enclosing component name (`data-pa-comp`) of the target. */
  component: string | null;
  /** Outer→inner chain of distinct enclosing component names. */
  componentPath: string[] | null;
  /**
   * Loop-instance disambiguation — which of N elements sharing the
   * target's `data-pa-loc` was clicked, and a fingerprint to recognise
   * it. All null unless the loc was rendered more than once.
   */
  instanceIndex: number | null;
  instanceTotal: number | null;
  instanceFingerprint: string | null;
  screenshot: string;
  status: Status;
  worktreeState: WorktreeState;
  note: string | null;
  commitSha: string | null;
  agentSessionId: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

type Db = SqliteRemoteDatabase<typeof schema>;

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
    // Uses Node's built-in node:sqlite (stable since Node 22.13) so
    // installing @pinagent/mcp doesn't require a native build step.
    // Same SQLite engine and on-disk format as the dev server.
    const raw = new DatabaseSync(dbPath);
    raw.exec('PRAGMA journal_mode = WAL');
    // Wait (up to 5s) instead of throwing SQLITE_BUSY when the dev server is
    // mid-write — `resolve_feedback` is a write that races the dev server's
    // event-bus inserts. Mirrors the dev server's pragma (db/client.ts).
    raw.exec('PRAGMA busy_timeout = 5000');
    raw.exec('PRAGMA foreign_keys = ON');
    // The route process owns migrations. MCP may start before the
    // route, in which case the DB file might not have the schema yet.
    // We only READ + occasionally UPDATE, and the route applies
    // migrations on its first connect — but if MCP is alone in the
    // wild (no dev server yet), we won't have tables. That's fine:
    // queries return empty results until the route runs.
    this.dbHandle = drizzle(
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
      { schema },
    );
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

  /**
   * Full transcript for one conversation, in insertion order. Mirror
   * of `@pinagent/agent-runner.Storage.listMessages` — reads the same
   * `messages` table the dev-server's bus writes to, skipping the
   * `__finished` sentinel (internal bookkeeping subscribers shouldn't
   * see). Returns `[]` for invalid or unknown ids.
   */
  async listMessages(id: string): Promise<AgentEvent[]> {
    if (!ID_RE.test(id)) return [];
    await this.maybeImportLegacy();
    try {
      const rows = await this.db()
        .select()
        .from(messages)
        .where(and(eq(messages.conversationId, id), notInArray(messages.role, ['__finished'])))
        .orderBy(asc(messages.id));
      return rows.map((r) => r.content as unknown as AgentEvent);
    } catch {
      // Schema not yet applied (MCP started before route); treat as empty.
      return [];
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
        worktreeState: rec.worktreeState,
        note: rec.note,
        commitSha: rec.commitSha,
        agentSessionId: rec.agentSessionId,
        updatedAt: new Date(),
        resolvedAt: rec.resolvedAt ? parseDate(rec.resolvedAt) : null,
      })
      .where(eq(conversations.id, rec.id));
  }

  /**
   * Append a row to the audit log. Same table the dev-server's
   * `recordAuditEvent` writes to, intentionally so the History →
   * Activity feed shows every meaningful project event regardless of
   * which process produced it. Best-effort: a DB failure here must not
   * mask the calling `resolve_feedback` success.
   */
  async recordAuditEvent(input: {
    conversationId: string | null;
    actor: 'agent' | 'user' | 'system';
    action: string;
    payload?: Record<string, unknown>;
  }): Promise<void> {
    try {
      const db = this.db();
      await db.insert(auditEvents).values({
        conversationId: input.conversationId,
        actor: input.actor,
        action: input.action,
        payload: input.payload ?? {},
      });
    } catch {
      // Migrations may not have applied yet, or the conversation row may
      // have been deleted between read and audit-write. Either way, drop
      // silently — the conversation change itself already succeeded.
    }
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
    additionalAnchors: a?.additionalAnchors ?? null,
    component: a?.component ?? null,
    componentPath: a?.componentPath ?? null,
    instanceIndex: a?.instanceIndex ?? null,
    instanceTotal: a?.instanceTotal ?? null,
    instanceFingerprint: a?.instanceFingerprint ?? null,
    screenshot: join('screenshots', `${c.id}.png`),
    status: c.status,
    worktreeState: c.worktreeState,
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
