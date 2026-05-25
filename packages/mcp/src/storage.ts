// Mirror of @pinpoint/vite-plugin/src/storage.ts but read-focused.
// Duplicated to keep mcp deploy-independent from the plugin package.
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
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
  createdAt: string;
  resolvedAt: string | null;
}

export class Storage {
  readonly root: string;
  readonly feedbackDir: string;

  constructor(root: string) {
    this.root = root;
    this.feedbackDir = join(root, '.pinpoint', 'feedback');
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

  async readScreenshot(rec: FeedbackRecord): Promise<Buffer | null> {
    const abs = join(this.root, '.pinpoint', rec.screenshot);
    if (!existsSync(abs)) return null;
    return readFile(abs);
  }

  async write(rec: FeedbackRecord): Promise<void> {
    await mkdir(this.feedbackDir, { recursive: true });
    const p = this.recordPath(rec.id);
    const tmp = `${p}.tmp`;
    await writeFile(tmp, `${JSON.stringify(rec, null, 2)}\n`, 'utf8');
    await rename(tmp, p);
  }

  private recordPath(id: string): string {
    return join(this.feedbackDir, `${id}.json`);
  }
}

export function isInsideRoot(root: string, target: string): boolean {
  const r = resolve(root);
  const t = resolve(target);
  const rel = relative(r, t);
  return !rel.startsWith('..') && rel !== '..' && !rel.startsWith(`..${'/'}`);
}
