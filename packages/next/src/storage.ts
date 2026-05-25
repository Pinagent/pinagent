import { Buffer } from 'node:buffer';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { z } from 'zod';
import { asc, conversations, eq, widgetAnchors } from '@pinpoint/db';
import { type Db, getDb } from './db/client';

export const ID_RE = /^[A-Za-z0-9_-]{8,16}$/;

export const FeedbackInputSchema = z.object({
  comment: z.string().min(1).max(8000),
  loc: z
    .object({
      file: z.string().min(1).max(512),
      line: z.number().int().min(1).max(1_000_000),
      col: z.number().int().min(0).max(1_000_000),
    })
    .nullable(),
  selector: z.string().max(2000),
  url: z.string().max(2048),
  viewport: z.object({
    w: z.number().int().min(1),
    h: z.number().int().min(1),
  }),
  userAgent: z.string().max(1024),
  screenshot: z.string().min(1),
  createdAt: z.string().min(1),
});
export type FeedbackInput = z.infer<typeof FeedbackInputSchema>;

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
  /** Path relative to .pinpoint/, e.g. `screenshots/abc.png`. */
  screenshot: string;
  status: Status;
  note: string | null;
  commitSha: string | null;
  /**
   * Claude Agent SDK session id, set the first time an SDK-backed agent
   * runs against this feedback. Lets follow-up turns resume the same
   * conversation rather than starting fresh.
   */
  agentSessionId: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export const PatchSchema = z.object({
  status: StatusSchema.optional(),
  note: z.string().max(8000).nullable().optional(),
  commitSha: z.string().max(64).nullable().optional(),
  agentSessionId: z.string().max(128).nullable().optional(),
});
export type Patch = z.infer<typeof PatchSchema>;

/**
 * Server-side feedback storage. Backed by SQLite via Drizzle on the
 * shared `@pinpoint/db` schema; screenshots stay on disk as PNG files
 * under `.pinpoint/screenshots/` because they're large binary blobs.
 *
 * The class deliberately preserves the v1 `FeedbackRecord` shape and
 * method names so the MCP server, route handler, and agent code don't
 * need to change. Internally it joins `conversations` and
 * `widget_anchors` on every read.
 *
 * On first open, any legacy `.pinpoint/feedback/<id>.json` files are
 * imported into SQLite (and left on disk as a backup). Once they're in
 * the DB, subsequent reads come from SQLite.
 */
export class Storage {
  readonly root: string;
  readonly feedbackDir: string;
  readonly screenshotsDir: string;
  private legacyImportDone = false;

  constructor(root: string) {
    this.root = root;
    this.feedbackDir = join(root, '.pinpoint', 'feedback');
    this.screenshotsDir = join(root, '.pinpoint', 'screenshots');
  }

  private db(): Db {
    return getDb(this.root);
  }

  private async ensureDirs(): Promise<void> {
    await mkdir(this.screenshotsDir, { recursive: true });
  }

  /**
   * One-shot import of legacy JSON feedback records into SQLite.
   * Safe to call multiple times — uses ON CONFLICT DO NOTHING so
   * already-imported rows aren't overwritten.
   */
  private async maybeImportLegacy(): Promise<void> {
    if (this.legacyImportDone) return;
    this.legacyImportDone = true;
    if (!existsSync(this.feedbackDir)) return;
    try {
      const names = await readdir(this.feedbackDir);
      for (const n of names) {
        if (!n.endsWith('.json') || n.endsWith('.tmp')) continue;
        const id = n.slice(0, -'.json'.length);
        if (!ID_RE.test(id)) continue;
        try {
          const raw = await readFile(join(this.feedbackDir, n), 'utf8');
          const rec = JSON.parse(raw) as Partial<FeedbackRecord>;
          if (!rec.id || !rec.comment) continue;
          await this.insertRecord(rec as FeedbackRecord);
        } catch {
          // Malformed file — skip silently. Original stays on disk.
        }
      }
    } catch {
      // No feedback dir or permission issue; not fatal.
    }
  }

  private async insertRecord(rec: FeedbackRecord): Promise<void> {
    const db = this.db();
    await db
      .insert(conversations)
      .values({
        id: rec.id,
        comment: rec.comment,
        agentSessionId: rec.agentSessionId ?? null,
        status: rec.status,
        note: rec.note ?? null,
        commitSha: rec.commitSha ?? null,
        createdAt: parseDate(rec.createdAt),
        updatedAt: parseDate(rec.createdAt),
        resolvedAt: rec.resolvedAt ? parseDate(rec.resolvedAt) : null,
      })
      .onConflictDoNothing();

    await db
      .insert(widgetAnchors)
      .values({
        conversationId: rec.id,
        url: rec.url,
        file: rec.file,
        line: rec.line,
        col: rec.col,
        selector: rec.selector,
        viewportW: rec.viewport.w,
        viewportH: rec.viewport.h,
        userAgent: rec.userAgent,
      })
      .onConflictDoNothing();
  }

  async create(id: string, input: FeedbackInput): Promise<FeedbackRecord> {
    await this.ensureDirs();

    const pngBuf = Buffer.from(input.screenshot, 'base64');
    const pngRel = join('screenshots', `${id}.png`);
    const pngAbs = join(this.root, '.pinpoint', pngRel);
    await this.atomicWriteBytes(pngAbs, pngBuf);

    const db = this.db();
    const createdAt = parseDate(input.createdAt);
    await db.insert(conversations).values({
      id,
      comment: input.comment,
      status: 'pending',
      createdAt,
      updatedAt: createdAt,
    });
    await db.insert(widgetAnchors).values({
      conversationId: id,
      url: input.url,
      file: input.loc?.file ?? null,
      line: input.loc?.line ?? null,
      col: input.loc?.col ?? null,
      selector: input.selector,
      viewportW: input.viewport.w,
      viewportH: input.viewport.h,
      userAgent: input.userAgent,
    });

    return {
      id,
      comment: input.comment,
      file: input.loc?.file ?? null,
      line: input.loc?.line ?? null,
      col: input.loc?.col ?? null,
      selector: input.selector,
      url: input.url,
      viewport: input.viewport,
      userAgent: input.userAgent,
      screenshot: pngRel,
      status: 'pending',
      note: null,
      commitSha: null,
      agentSessionId: null,
      createdAt: input.createdAt,
      resolvedAt: null,
    };
  }

  async list(): Promise<FeedbackRecord[]> {
    await this.maybeImportLegacy();
    const db = this.db();
    const rows = await db
      .select()
      .from(conversations)
      .leftJoin(widgetAnchors, eq(conversations.id, widgetAnchors.conversationId))
      .orderBy(asc(conversations.createdAt));
    return rows.map((r) => rowToRecord(r));
  }

  async read(id: string): Promise<FeedbackRecord | null> {
    if (!ID_RE.test(id)) return null;
    await this.maybeImportLegacy();
    const db = this.db();
    const rows = await db
      .select()
      .from(conversations)
      .leftJoin(widgetAnchors, eq(conversations.id, widgetAnchors.conversationId))
      .where(eq(conversations.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return rowToRecord(row);
  }

  async readScreenshotBase64(rec: FeedbackRecord): Promise<string | null> {
    const abs = join(this.root, '.pinpoint', rec.screenshot);
    if (!existsSync(abs)) return null;
    const buf = await readFile(abs);
    return buf.toString('base64');
  }

  /**
   * Returns the patched record + the previous status (so callers can
   * tell whether a terminal-status transition just happened and fire a
   * `status_changed` event without re-reading).
   */
  async patchWithDiff(
    id: string,
    patch: Patch,
  ): Promise<{ record: FeedbackRecord; previousStatus: Status } | null> {
    if (!ID_RE.test(id)) return null;
    const current = await this.read(id);
    if (!current) return null;
    const previousStatus = current.status;

    const update: Partial<typeof conversations.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (patch.status !== undefined) {
      update.status = patch.status;
      if (patch.status !== 'pending') {
        update.resolvedAt = new Date();
      } else {
        update.resolvedAt = null;
      }
    }
    if (patch.note !== undefined) update.note = patch.note;
    if (patch.commitSha !== undefined) update.commitSha = patch.commitSha;
    if (patch.agentSessionId !== undefined) update.agentSessionId = patch.agentSessionId;

    const db = this.db();
    await db.update(conversations).set(update).where(eq(conversations.id, id));

    const next = await this.read(id);
    if (!next) return null;
    return { record: next, previousStatus };
  }

  async patch(id: string, patch: Patch): Promise<FeedbackRecord | null> {
    const result = await this.patchWithDiff(id, patch);
    return result ? result.record : null;
  }

  private async atomicWriteBytes(p: string, data: Buffer): Promise<void> {
    const tmp = `${p}.tmp`;
    await writeFile(tmp, data);
    await rename(tmp, p);
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
    // Derived from id — every screenshot lives at the same path.
    screenshot: join('screenshots', `${c.id}.png`),
    status: c.status,
    note: c.note,
    commitSha: c.commitSha,
    agentSessionId: c.agentSessionId,
    createdAt: c.createdAt.toISOString(),
    resolvedAt: c.resolvedAt ? c.resolvedAt.toISOString() : null,
  };
}

export async function isInGitignore(root: string): Promise<boolean> {
  const gi = resolve(root, '.gitignore');
  if (!existsSync(gi)) return false;
  try {
    const txt = await readFile(gi, 'utf8');
    return txt
      .split(/\r?\n/)
      .map((s) => s.trim())
      .some(
        (s) => s === '.pinpoint' || s === '.pinpoint/' || s === '/.pinpoint' || s === '/.pinpoint/',
      );
  } catch {
    return false;
  }
}

export function isInsideRoot(root: string, target: string): boolean {
  const r = resolve(root);
  const t = resolve(target);
  const rel = relative(r, t);
  return !rel.startsWith('..') && !rel.startsWith(`..${'/'}`) && rel !== '..';
}

export { createReadStream, stat };
