import { Buffer } from 'node:buffer';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { z } from 'zod';

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
  screenshot: string; // path relative to .pinagent/
  status: Status;
  note: string | null;
  commitSha: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export const PatchSchema = z.object({
  status: StatusSchema.optional(),
  note: z.string().max(8000).nullable().optional(),
  commitSha: z.string().max(64).nullable().optional(),
});
export type Patch = z.infer<typeof PatchSchema>;

export class Storage {
  readonly root: string;
  readonly feedbackDir: string;
  readonly screenshotsDir: string;

  constructor(root: string) {
    this.root = root;
    this.feedbackDir = join(root, '.pinagent', 'feedback');
    this.screenshotsDir = join(root, '.pinagent', 'screenshots');
  }

  private async ensureDirs(): Promise<void> {
    await mkdir(this.feedbackDir, { recursive: true });
    await mkdir(this.screenshotsDir, { recursive: true });
  }

  async create(id: string, input: FeedbackInput): Promise<FeedbackRecord> {
    await this.ensureDirs();

    const pngBuf = Buffer.from(input.screenshot, 'base64');
    const pngRel = join('screenshots', `${id}.png`);
    const pngAbs = join(this.root, '.pinagent', pngRel);
    await this.atomicWriteBytes(pngAbs, pngBuf);

    const record: FeedbackRecord = {
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
      createdAt: input.createdAt,
      resolvedAt: null,
    };

    await this.atomicWriteJson(this.recordPath(id), record);
    return record;
  }

  async list(): Promise<FeedbackRecord[]> {
    if (!existsSync(this.feedbackDir)) return [];
    const names = await readdir(this.feedbackDir);
    const out: FeedbackRecord[] = [];
    for (const n of names) {
      if (!n.endsWith('.json') || n.endsWith('.tmp')) continue;
      const id = n.slice(0, -'.json'.length);
      if (!ID_RE.test(id)) continue;
      try {
        const r = await this.read(id);
        if (r) out.push(r);
      } catch {
        // skip malformed
      }
    }
    out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return out;
  }

  async read(id: string): Promise<FeedbackRecord | null> {
    if (!ID_RE.test(id)) return null;
    const p = this.recordPath(id);
    if (!existsSync(p)) return null;
    const raw = await readFile(p, 'utf8');
    return JSON.parse(raw) as FeedbackRecord;
  }

  async readScreenshotBase64(rec: FeedbackRecord): Promise<string | null> {
    const abs = join(this.root, '.pinagent', rec.screenshot);
    if (!existsSync(abs)) return null;
    const buf = await readFile(abs);
    return buf.toString('base64');
  }

  async patch(id: string, patch: Patch): Promise<FeedbackRecord | null> {
    const rec = await this.read(id);
    if (!rec) return null;
    const next: FeedbackRecord = { ...rec };
    if (patch.status !== undefined) {
      next.status = patch.status;
      if (patch.status !== 'pending' && !next.resolvedAt) {
        next.resolvedAt = new Date().toISOString();
      }
      if (patch.status === 'pending') {
        next.resolvedAt = null;
      }
    }
    if (patch.note !== undefined) next.note = patch.note;
    if (patch.commitSha !== undefined) next.commitSha = patch.commitSha;

    await this.atomicWriteJson(this.recordPath(id), next);
    return next;
  }

  private recordPath(id: string): string {
    return join(this.feedbackDir, `${id}.json`);
  }

  private async atomicWriteJson(p: string, data: unknown): Promise<void> {
    const tmp = `${p}.tmp`;
    await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    await rename(tmp, p);
  }

  private async atomicWriteBytes(p: string, data: Buffer): Promise<void> {
    const tmp = `${p}.tmp`;
    await writeFile(tmp, data);
    await rename(tmp, p);
  }
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
        (s) => s === '.pinagent' || s === '.pinagent/' || s === '/.pinagent' || s === '/.pinagent/',
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
