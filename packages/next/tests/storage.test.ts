import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type FeedbackInput,
  Storage,
  isInGitignore,
  isInsideRoot,
} from '../src/storage';

// 1x1 transparent PNG.
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

function makeInput(overrides: Partial<FeedbackInput> = {}): FeedbackInput {
  return {
    comment: 'make it red',
    loc: { file: 'src/Foo.tsx', line: 42, col: 7 },
    selector: 'main > div > button',
    url: 'http://localhost:3000/',
    viewport: { w: 1280, h: 720 },
    userAgent: 'test-agent',
    screenshot: TINY_PNG_B64,
    createdAt: '2026-05-25T12:00:00.000Z',
    ...overrides,
  };
}

let root: string;

beforeEach(async () => {
  root = join(tmpdir(), `pp-storage-${nanoid(8)}`);
  await mkdir(root, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('Storage', () => {
  it('round-trips create → read', async () => {
    const s = new Storage(root);
    const id = nanoid(10);
    const created = await s.create(id, makeInput());
    expect(created.id).toBe(id);
    expect(created.status).toBe('pending');
    expect(created.note).toBeNull();
    expect(created.commitSha).toBeNull();
    expect(created.agentSessionId).toBeNull();
    expect(created.resolvedAt).toBeNull();

    const read = await s.read(id);
    expect(read).toEqual(created);
  });

  it('create writes the screenshot under .pinpoint/screenshots/<id>.png', async () => {
    const s = new Storage(root);
    const id = nanoid(10);
    await s.create(id, makeInput());
    const pngPath = join(root, '.pinpoint', 'screenshots', `${id}.png`);
    expect(existsSync(pngPath)).toBe(true);
  });

  it('readScreenshotBase64 returns the same bytes that went in', async () => {
    const s = new Storage(root);
    const id = nanoid(10);
    const rec = await s.create(id, makeInput());
    const out = await s.readScreenshotBase64(rec);
    expect(out).toBe(TINY_PNG_B64);
  });

  it('list returns nothing when no records exist', async () => {
    const s = new Storage(root);
    expect(await s.list()).toEqual([]);
  });

  it('list returns records sorted by createdAt ascending', async () => {
    const s = new Storage(root);
    await s.create(nanoid(10), makeInput({ createdAt: '2026-05-25T12:00:02.000Z' }));
    await s.create(nanoid(10), makeInput({ createdAt: '2026-05-25T12:00:00.000Z' }));
    await s.create(nanoid(10), makeInput({ createdAt: '2026-05-25T12:00:01.000Z' }));
    const list = await s.list();
    expect(list.map((r) => r.createdAt)).toEqual([
      '2026-05-25T12:00:00.000Z',
      '2026-05-25T12:00:01.000Z',
      '2026-05-25T12:00:02.000Z',
    ]);
  });

  // Note: the flat-JSON `.tmp` atomic-write tests that used to live
  // here were dropped when Storage migrated to SQLite. SQLite handles
  // its own atomicity; the directory layout no longer has half-written
  // JSON files to skip.

  it('read returns null for an invalid id (no filesystem hit)', async () => {
    const s = new Storage(root);
    expect(await s.read('!')).toBeNull();
    expect(await s.read('')).toBeNull();
    expect(await s.read('short')).toBeNull();
  });

  it('read returns null when the file does not exist', async () => {
    const s = new Storage(root);
    expect(await s.read('aBcDeFgHiJ')).toBeNull();
  });

  it('read normalises missing agentSessionId to null (legacy v0.0.16 records)', async () => {
    const s = new Storage(root);
    const id = 'legacy0000';
    // Hand-write a record that predates the agentSessionId field.
    await mkdir(join(root, '.pinpoint', 'feedback'), { recursive: true });
    const legacy = {
      id,
      comment: 'old',
      file: null,
      line: null,
      col: null,
      selector: '',
      url: '',
      viewport: { w: 0, h: 0 },
      userAgent: '',
      screenshot: '',
      status: 'pending',
      note: null,
      commitSha: null,
      createdAt: '2026-01-01',
      resolvedAt: null,
    };
    await writeFile(
      join(root, '.pinpoint', 'feedback', `${id}.json`),
      JSON.stringify(legacy),
      'utf8',
    );
    const read = await s.read(id);
    expect(read?.agentSessionId).toBeNull();
  });

  describe('patch', () => {
    it('updates only the provided fields', async () => {
      const s = new Storage(root);
      const id = nanoid(10);
      const created = await s.create(id, makeInput());
      const patched = await s.patch(id, { note: 'agent fixed' });
      expect(patched?.note).toBe('agent fixed');
      expect(patched?.status).toBe(created.status);
      expect(patched?.commitSha).toBeNull();
    });

    it('sets resolvedAt on status change away from pending', async () => {
      const s = new Storage(root);
      const id = nanoid(10);
      await s.create(id, makeInput());
      const patched = await s.patch(id, { status: 'fixed' });
      expect(patched?.status).toBe('fixed');
      expect(patched?.resolvedAt).toBeTruthy();
      expect(new Date(patched!.resolvedAt!).toString()).not.toBe('Invalid Date');
    });

    it('clears resolvedAt when status returns to pending', async () => {
      const s = new Storage(root);
      const id = nanoid(10);
      await s.create(id, makeInput());
      await s.patch(id, { status: 'fixed' });
      const patched = await s.patch(id, { status: 'pending' });
      expect(patched?.resolvedAt).toBeNull();
    });

    it('returns null for an unknown id', async () => {
      const s = new Storage(root);
      expect(await s.patch('aBcDeFgHiJ', { note: 'x' })).toBeNull();
    });

    it('persists agentSessionId', async () => {
      const s = new Storage(root);
      const id = nanoid(10);
      await s.create(id, makeInput());
      await s.patch(id, { agentSessionId: 'sess-abc-123' });
      const read = await s.read(id);
      expect(read?.agentSessionId).toBe('sess-abc-123');
    });
  });

});

describe('isInGitignore', () => {
  it('returns false when there is no .gitignore', async () => {
    expect(await isInGitignore(root)).toBe(false);
  });

  it.each([
    ['.pinpoint'],
    ['.pinpoint/'],
    ['/.pinpoint'],
    ['/.pinpoint/'],
  ])('accepts the line %s', async (line) => {
    await writeFile(join(root, '.gitignore'), `node_modules\n${line}\nbuild\n`, 'utf8');
    expect(await isInGitignore(root)).toBe(true);
  });

  it('rejects unrelated lines', async () => {
    await writeFile(
      join(root, '.gitignore'),
      'node_modules\n.next\ndist\n',
      'utf8',
    );
    expect(await isInGitignore(root)).toBe(false);
  });

  it('ignores leading/trailing whitespace on each line', async () => {
    await writeFile(join(root, '.gitignore'), '  .pinpoint  \n', 'utf8');
    expect(await isInGitignore(root)).toBe(true);
  });
});

describe('isInsideRoot', () => {
  it('returns true for paths inside the root', () => {
    expect(isInsideRoot('/abs/root', '/abs/root/sub/file.txt')).toBe(true);
    expect(isInsideRoot('/abs/root', '/abs/root')).toBe(true);
  });

  it('returns false for parent directories', () => {
    expect(isInsideRoot('/abs/root', '/abs')).toBe(false);
    expect(isInsideRoot('/abs/root', '/abs/other')).toBe(false);
  });

  it('returns false for path traversal escapes', () => {
    expect(isInsideRoot('/abs/root', '/abs/root/../outside')).toBe(false);
  });
});
