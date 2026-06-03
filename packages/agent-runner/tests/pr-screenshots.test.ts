// SPDX-License-Identifier: Apache-2.0
/**
 * `pr-screenshots` — committing feedback PNGs onto a PR branch and building
 * the `?raw=true` blob-URL markdown.
 *
 * Exercises the real git path (temp repos, no network) since the whole point
 * is the force-add past `.pinagent`'s gitignore and the branch-commit.
 */
import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

type Mod = typeof import('../src/pr-screenshots');
let mod: Mod;

const ROOT = join(tmpdir(), `pa-prshot-${nanoid(8)}`);
const NO_REMOTE = join(tmpdir(), `pa-prshot-noremote-${nanoid(8)}`);

function git(cwd: string, args: string[]): Promise<{ code: number; stdout: string }> {
  return new Promise((res, rej) => {
    const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'ignore'] });
    let stdout = '';
    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.on('error', rej);
    child.on('close', (code) => res({ code: code ?? -1, stdout }));
  });
}

async function initRepo(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await git(dir, ['init', '-b', 'main']);
  await git(dir, ['config', 'user.email', 'pinagent-test@example.com']);
  await git(dir, ['config', 'user.name', 'Pinagent Test']);
  await git(dir, ['config', 'commit.gpgsign', 'false']);
  await writeFile(join(dir, '.gitignore'), '.pinagent\n', 'utf8');
  await writeFile(join(dir, 'README.md'), 'hi\n', 'utf8');
  await git(dir, ['add', '-A']);
  await git(dir, ['commit', '-m', 'init']);
}

/** Drop a fake screenshot at `.pinagent/<rel>`. */
async function writeShot(dir: string, rel: string): Promise<void> {
  const abs = join(dir, '.pinagent', rel);
  await mkdir(join(abs, '..'), { recursive: true });
  await writeFile(abs, 'PNGBYTES', 'utf8');
}

beforeAll(async () => {
  await rm(ROOT, { recursive: true, force: true });
  await rm(NO_REMOTE, { recursive: true, force: true });
  await initRepo(ROOT);
  await git(ROOT, ['remote', 'add', 'origin', 'git@github.com:owner/repo.git']);
  await initRepo(NO_REMOTE);
  mod = await import('../src/pr-screenshots');
});

afterAll(async () => {
  await rm(ROOT, { recursive: true, force: true });
  await rm(NO_REMOTE, { recursive: true, force: true });
});

describe('stageScreenshotAssets', () => {
  it('force-adds the PNG past gitignore, commits it, and emits a raw blob URL', async () => {
    await git(ROOT, ['checkout', '-b', 'feat/blue']);
    await writeShot(ROOT, 'screenshots/a.png');

    const res = await mod.stageScreenshotAssets(ROOT, ROOT, 'feat/blue', [
      { id: 'a', screenshot: 'screenshots/a.png', caption: 'make it blue' },
    ]);

    expect(res.committed).toBe(1);
    expect(res.ids).toEqual(['a']);
    expect(res.markdown).toContain('### Screenshots');
    expect(res.markdown).toContain('**make it blue**');
    expect(res.markdown).toContain(
      'https://github.com/owner/repo/blob/feat/blue/.pinagent/pr-assets/a.png?raw=true',
    );

    // The asset is actually tracked on the branch despite `.pinagent` being ignored.
    const tracked = await git(ROOT, ['ls-files', '--', '.pinagent/pr-assets/a.png']);
    expect(tracked.stdout.trim()).toBe('.pinagent/pr-assets/a.png');

    await git(ROOT, ['checkout', 'main']);
  });

  it('returns empty markdown and commits nothing when the origin is not GitHub', async () => {
    await git(NO_REMOTE, ['checkout', '-b', 'feat/x']);
    await writeShot(NO_REMOTE, 'screenshots/a.png');

    const res = await mod.stageScreenshotAssets(NO_REMOTE, NO_REMOTE, 'feat/x', [
      { id: 'a', screenshot: 'screenshots/a.png' },
    ]);

    expect(res).toEqual({ markdown: '', committed: 0, ids: [] });
    const tracked = await git(NO_REMOTE, ['ls-files', '--', '.pinagent/pr-assets/a.png']);
    expect(tracked.stdout.trim()).toBe('');
    await git(NO_REMOTE, ['checkout', 'main']);
  });

  it('skips screenshots whose file is missing', async () => {
    await git(ROOT, ['checkout', '-b', 'feat/missing']);
    const res = await mod.stageScreenshotAssets(ROOT, ROOT, 'feat/missing', [
      { id: 'gone', screenshot: 'screenshots/gone.png' },
    ]);
    expect(res).toEqual({ markdown: '', committed: 0, ids: [] });
    await git(ROOT, ['checkout', 'main']);
  });

  it('does nothing for an empty screenshot list', async () => {
    const res = await mod.stageScreenshotAssets(ROOT, ROOT, 'main', []);
    expect(res).toEqual({ markdown: '', committed: 0, ids: [] });
  });
});

describe('selectUnshippedScreenshots', () => {
  // status=fixed, inline (no branch), unshipped (no commitSha), has screenshot.
  const fixed = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    comment: `${id} comment\nsecond line`,
    status: 'fixed',
    branch: null,
    commitSha: null,
    screenshot: `screenshots/${id}.png`,
    ...over,
  });

  it('keeps resolved inline feedback that has a screenshot and is not yet shipped', () => {
    const { shots, ids } = mod.selectUnshippedScreenshots([fixed('a'), fixed('b')]);
    expect(ids).toEqual(['a', 'b']);
    expect(shots.map((s) => s.id)).toEqual(['a', 'b']);
    // Caption is the first non-empty line of the comment.
    expect(shots[0]?.caption).toBe('a comment');
  });

  it('excludes unresolved, already-shipped, worktree-mode, and screenshot-less feedback', () => {
    const { ids } = mod.selectUnshippedScreenshots([
      fixed('keep'),
      fixed('pending', { status: 'pending' }),
      fixed('wontfix', { status: 'wontfix' }),
      fixed('shipped', { commitSha: 'abc1234' }),
      fixed('worktree', { branch: 'pinagent/x' }),
      fixed('noshot', { screenshot: null }),
    ]);
    expect(ids).toEqual(['keep']);
  });
});
