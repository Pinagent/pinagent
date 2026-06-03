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

    expect(res).toEqual({ markdown: '', committed: 0 });
    const tracked = await git(NO_REMOTE, ['ls-files', '--', '.pinagent/pr-assets/a.png']);
    expect(tracked.stdout.trim()).toBe('');
    await git(NO_REMOTE, ['checkout', 'main']);
  });

  it('skips screenshots whose file is missing', async () => {
    await git(ROOT, ['checkout', '-b', 'feat/missing']);
    const res = await mod.stageScreenshotAssets(ROOT, ROOT, 'feat/missing', [
      { id: 'gone', screenshot: 'screenshots/gone.png' },
    ]);
    expect(res).toEqual({ markdown: '', committed: 0 });
    await git(ROOT, ['checkout', 'main']);
  });

  it('does nothing for an empty screenshot list', async () => {
    const res = await mod.stageScreenshotAssets(ROOT, ROOT, 'main', []);
    expect(res).toEqual({ markdown: '', committed: 0 });
  });
});

describe('selectBranchScreenshots', () => {
  it('matches candidates whose commitSha is in base..HEAD (full or short sha)', async () => {
    await git(ROOT, ['checkout', '-b', 'feat/sel']);
    await writeFile(join(ROOT, 'change.txt'), 'x\n', 'utf8');
    await git(ROOT, ['add', '-A']);
    await git(ROOT, ['commit', '-m', 'a change']);
    const head = (await git(ROOT, ['rev-parse', 'HEAD'])).stdout.trim();

    const shots = await mod.selectBranchScreenshots(ROOT, 'main', [
      { id: 'full', screenshot: 'screenshots/f.png', commitSha: head, comment: 'full sha\nsecond' },
      {
        id: 'short',
        screenshot: 'screenshots/s.png',
        commitSha: head.slice(0, 8),
        comment: 'short',
      },
      { id: 'miss', screenshot: 'screenshots/m.png', commitSha: 'deadbeefdeadbeef', comment: 'no' },
      { id: 'nosha', screenshot: 'screenshots/n.png', commitSha: null, comment: 'no sha' },
    ]);

    expect(shots.map((s) => s.id).sort()).toEqual(['full', 'short']);
    // Caption is the first non-empty line of the comment.
    expect(shots.find((s) => s.id === 'full')?.caption).toBe('full sha');

    await git(ROOT, ['checkout', 'main']);
  });

  it('returns nothing when no candidate carries a commit sha', async () => {
    const shots = await mod.selectBranchScreenshots(ROOT, 'main', [
      { id: 'x', screenshot: 'screenshots/x.png', commitSha: null, comment: 'c' },
    ]);
    expect(shots).toEqual([]);
  });
});

describe('toScreenshotCandidates', () => {
  it('keeps only records with both a screenshot and a commit sha', () => {
    const out = mod.toScreenshotCandidates([
      { id: 'a', screenshot: 'screenshots/a.png', commitSha: 'abc1234', comment: 'a' },
      { id: 'b', screenshot: null, commitSha: 'abc1234', comment: 'b' },
      { id: 'c', screenshot: 'screenshots/c.png', commitSha: null, comment: 'c' },
    ]);
    expect(out.map((c) => c.id)).toEqual(['a']);
  });
});
