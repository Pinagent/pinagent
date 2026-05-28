// SPDX-License-Identifier: Apache-2.0
/**
 * Pins the worktree-divergence flag on `listChanges`. The agent never
 * commits — Land does it on the user's behalf — so any commit on the
 * worktree branch means a human reached in and committed manually.
 * Walks the real git ops end-to-end against a fixture repo, no mocks.
 */
import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

type ChangesMod = typeof import('../src/changes');
type StorageMod = typeof import('../src/storage');

let changesMod: ChangesMod;
let storageMod: StorageMod;

const ROOT = join(tmpdir(), `pa-changes-div-${nanoid(8)}`);

function git(
  cwd: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((res, rej) => {
    const child = spawn('git', args, { cwd, stdio: 'pipe' });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString('utf8');
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString('utf8');
    });
    child.on('error', rej);
    child.on('exit', (code) => res({ code: code ?? -1, stdout, stderr }));
  });
}

async function initFixtureRepo(): Promise<void> {
  await rm(ROOT, { recursive: true, force: true });
  await mkdir(ROOT, { recursive: true });
  await git(ROOT, ['init', '-b', 'main']);
  await git(ROOT, ['config', 'user.email', 'pinagent-test@example.com']);
  await git(ROOT, ['config', 'user.name', 'Pinagent Test']);
  await git(ROOT, ['config', 'commit.gpgsign', 'false']);
  await writeFile(join(ROOT, 'README.md'), 'hello\n', 'utf8');
  await writeFile(join(ROOT, '.gitignore'), '.pinagent/\n', 'utf8');
  await git(ROOT, ['add', 'README.md', '.gitignore']);
  await git(ROOT, ['commit', '-m', 'init']);
}

async function makeFeedbackWithWorktree(): Promise<{ id: string; worktreePath: string }> {
  const id = nanoid(10);
  const storage = new storageMod.Storage(ROOT);
  await storage.create(id, {
    comment: 'tweak the README',
    loc: { file: 'README.md', line: 1, col: 1 },
    selector: 'h1',
    url: 'http://localhost:3000/',
    viewport: { w: 1280, h: 720 },
    userAgent: 'vitest',
    screenshot:
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    createdAt: new Date().toISOString(),
  });
  const worktreeDir = join(ROOT, '.pinagent', 'worktrees');
  await mkdir(worktreeDir, { recursive: true });
  const worktreePath = join(worktreeDir, id);
  const branch = `pinagent/${id}`;
  await git(ROOT, ['worktree', 'add', '-b', branch, worktreePath]);
  await storage.patch(id, { branch, worktreePath, worktreeState: 'active' });
  return { id, worktreePath };
}

beforeAll(async () => {
  process.env.PINAGENT_PROJECT_ROOT = ROOT;
  process.env.PINAGENT_SPAWN_AGENT = 'worktree';
  process.env.NODE_ENV = 'production';
  await initFixtureRepo();
  changesMod = await import('../src/changes');
  storageMod = await import('../src/storage');
});

afterAll(async () => {
  await rm(ROOT, { recursive: true, force: true });
});

beforeEach(async () => {
  // Drop leftover worktrees + pinagent branches between tests.
  await git(ROOT, ['checkout', 'main']);
  const list = await git(ROOT, ['branch', '--list', 'pinagent/*']);
  for (const line of list.stdout.split('\n')) {
    const name = line.trim().replace(/^\*\s*/, '');
    if (name.startsWith('pinagent/')) {
      await git(ROOT, ['branch', '-D', name]);
    }
  }
  await rm(join(ROOT, '.pinagent', 'worktrees'), { recursive: true, force: true });
  await git(ROOT, ['worktree', 'prune']);
});

describe('listChanges — externallyModified', () => {
  it('is false for a fresh worktree with no commits', async () => {
    const { id, worktreePath } = await makeFeedbackWithWorktree();
    // Agent-style: write a change but DON'T commit.
    await writeFile(join(worktreePath, 'README.md'), 'agent edit\n', 'utf8');

    const rows = await changesMod.listChanges(ROOT);
    const row = rows.find((r) => r.id === id);
    expect(row?.externallyModified).toBe(false);
    // Sanity: the row still shows the diff as expected.
    expect(row?.filesChanged).toBeGreaterThan(0);
  });

  it('is true when the user commits manually inside the worktree', async () => {
    const { id, worktreePath } = await makeFeedbackWithWorktree();
    await writeFile(join(worktreePath, 'README.md'), 'human commit\n', 'utf8');
    // The human reaches in and commits — same git invocation a power
    // user would run from their terminal.
    await git(worktreePath, ['add', 'README.md']);
    await git(worktreePath, ['commit', '-m', 'human tweak']);

    const rows = await changesMod.listChanges(ROOT);
    const row = rows.find((r) => r.id === id);
    expect(row?.externallyModified).toBe(true);
  });

  it('stays false for landed worktrees (no active git work to inspect)', async () => {
    const { id, worktreePath } = await makeFeedbackWithWorktree();
    await writeFile(join(worktreePath, 'README.md'), 'edit\n', 'utf8');
    // Simulate the post-land state without going through mergeWorktree:
    // just flip storage to 'landed'. The flag should stay false because
    // the row is read-only history at that point.
    const storage = new storageMod.Storage(ROOT);
    await storage.patch(id, { worktreeState: 'landed' });

    const rows = await changesMod.listChanges(ROOT);
    const row = rows.find((r) => r.id === id);
    expect(row?.externallyModified).toBe(false);
  });
});

describe('listChanges — preview', () => {
  it('is the first changed line for an active worktree with edits', async () => {
    const { id, worktreePath } = await makeFeedbackWithWorktree();
    // Replace README.md's "hello" with "agent edit".
    await writeFile(join(worktreePath, 'README.md'), 'agent edit\n', 'utf8');

    const rows = await changesMod.listChanges(ROOT);
    const row = rows.find((r) => r.id === id);
    // The first non-header content line in the diff is the `-hello`
    // deletion. Either `-` or `+` is acceptable depending on diff
    // formatting order — git emits the deletion before the addition
    // for the same hunk.
    expect(row?.preview).toMatch(/^[+-]/);
    expect(row?.preview).toMatch(/hello|agent edit/);
  });

  it('is empty for a fresh worktree with no edits', async () => {
    const { id } = await makeFeedbackWithWorktree();
    // Don't touch the worktree — no diff.
    const rows = await changesMod.listChanges(ROOT);
    const row = rows.find((r) => r.id === id);
    expect(row?.preview).toBe('');
  });

  it('truncates very long lines with an ellipsis', async () => {
    const { id, worktreePath } = await makeFeedbackWithWorktree();
    // Append (don't replace) so the only changed content line is the
    // long addition. Replacing the existing "hello" would surface
    // `-hello` as the first changed line, which doesn't truncate.
    await writeFile(join(worktreePath, 'README.md'), `hello\n${'x'.repeat(500)}\n`, 'utf8');

    const rows = await changesMod.listChanges(ROOT);
    const row = rows.find((r) => r.id === id);
    // 140-char cap including the leading +/- prefix; ellipsis added.
    expect(row?.preview.length).toBeLessThanOrEqual(140);
    expect(row?.preview.endsWith('…')).toBe(true);
  });

  it('is empty for landed worktrees (gone from disk; no live diff)', async () => {
    const { id, worktreePath } = await makeFeedbackWithWorktree();
    await writeFile(join(worktreePath, 'README.md'), 'edit\n', 'utf8');
    const storage = new storageMod.Storage(ROOT);
    await storage.patch(id, { worktreeState: 'landed' });

    const rows = await changesMod.listChanges(ROOT);
    const row = rows.find((r) => r.id === id);
    expect(row?.preview).toBe('');
  });
});
