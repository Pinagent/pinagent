import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * Phase H end-to-end git ops. Sets up a fresh git repo per test run with
 * a single committed file, then exercises `createWorktree` (already
 * tested elsewhere implicitly) followed by `mergeWorktree` /
 * `discardWorktree`.
 *
 * Runs against real git — no mocks. Slower than the SDK tests but the
 * subtle behaviour we care about (conflict detection, branch cleanup,
 * idempotent discard) is precisely the surface git owns.
 */

type AgentMod = typeof import('../src/agent');
type StorageMod = typeof import('../src/storage');

let agent: AgentMod;
let storageMod: StorageMod;

const ROOT = join(tmpdir(), `pa-merge-${nanoid(8)}`);

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
  // -b main so we don't depend on the user's `init.defaultBranch` config.
  await git(ROOT, ['init', '-b', 'main']);
  await git(ROOT, ['config', 'user.email', 'pinagent-test@example.com']);
  await git(ROOT, ['config', 'user.name', 'Pinagent Test']);
  await git(ROOT, ['config', 'commit.gpgsign', 'false']);
  await writeFile(join(ROOT, 'README.md'), 'hello\n', 'utf8');
  // Real users gitignore `.pinagent/` (the setup skill writes this for
  // them). Mirror that in the fixture so `git status --porcelain` sees
  // a clean tree — otherwise the conflict-abort assertion picks up the
  // untracked DB / worktrees directory.
  await writeFile(join(ROOT, '.gitignore'), '.pinagent/\n', 'utf8');
  await git(ROOT, ['add', 'README.md', '.gitignore']);
  await git(ROOT, ['commit', '-m', 'init']);
}

async function makeFeedbackWithWorktree(
  storage: InstanceType<StorageMod['Storage']>,
): Promise<string> {
  const id = nanoid(10);
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
  // Re-use the same internal logs dir spawnAgent would.
  const logsDir = join(ROOT, '.pinagent', 'logs');
  await mkdir(logsDir, { recursive: true });
  return id;
}

beforeAll(async () => {
  process.env.PINAGENT_PROJECT_ROOT = ROOT;
  process.env.PINAGENT_SPAWN_AGENT = 'worktree';
  process.env.NODE_ENV = 'production';
  await initFixtureRepo();
  agent = await import('../src/agent');
  storageMod = await import('../src/storage');
});

afterAll(async () => {
  await rm(ROOT, { recursive: true, force: true });
});

beforeEach(async () => {
  // Reset to a known main between tests so prior merges don't leak.
  await git(ROOT, ['checkout', 'main']);
  await git(ROOT, ['reset', '--hard', 'HEAD']);
  // Drop any leftover pinagent/* branches and worktrees from prior tests.
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

describe('mergeWorktree — happy path', () => {
  it('lands an edit from the worktree as a merge commit on main', async () => {
    const storage = new storageMod.Storage(ROOT);
    const id = await makeFeedbackWithWorktree(storage);

    // spawnAgent normally does this; do it directly so the test stays
    // focused on land/discard rather than the SDK loop.
    const worktreePath = await callCreateWorktree(id);
    expect(worktreePath).toBeTruthy();

    // Agent-like edit, uncommitted.
    await writeFile(join(worktreePath, 'README.md'), 'hello world\n', 'utf8');

    const logPath = join(ROOT, '.pinagent', 'logs', `${id}.md`);
    const result = await agent.mergeWorktree(ROOT, id, logPath);

    expect(result.ok).toBe(true);
    expect(result.commitSha).toMatch(/^[0-9a-f]{40}$/);

    // Working tree on main has the agent's edit.
    const after = await readFile(join(ROOT, 'README.md'), 'utf8');
    expect(after).toBe('hello world\n');

    // Branch and worktree both cleaned up.
    const branches = await git(ROOT, ['branch', '--list', `pinagent/${id}`]);
    expect(branches.stdout.trim()).toBe('');
    const wt = await git(ROOT, ['worktree', 'list']);
    expect(wt.stdout).not.toContain(id);

    // DB row reflects the new state.
    const rec = await storage.read(id);
    expect(rec?.worktreeState).toBe('landed');
    expect(rec?.commitSha).toBe(result.commitSha);
  });

  it('treats an empty branch as a successful landing (no commit, still cleaned up)', async () => {
    const storage = new storageMod.Storage(ROOT);
    const id = await makeFeedbackWithWorktree(storage);
    await callCreateWorktree(id);
    // No edit — `ahead` count will be 0.

    const logPath = join(ROOT, '.pinagent', 'logs', `${id}.md`);
    const result = await agent.mergeWorktree(ROOT, id, logPath);

    expect(result.ok).toBe(true);
    expect(result.commitSha).toBeUndefined();

    const rec = await storage.read(id);
    expect(rec?.worktreeState).toBe('landed');
  });
});

describe('mergeWorktree — conflicts', () => {
  it('detects conflicted files and aborts the merge, leaving worktree intact', async () => {
    const storage = new storageMod.Storage(ROOT);
    const id = await makeFeedbackWithWorktree(storage);
    const worktreePath = await callCreateWorktree(id);

    // Agent edits line 1 of README.
    await writeFile(join(worktreePath, 'README.md'), 'agent edit\n', 'utf8');

    // Concurrently, main also edits line 1 — committed so the merge has
    // something to conflict against. Pinagent's land does the worktree
    // commit on the user's behalf; the conflict surfaces during merge.
    await writeFile(join(ROOT, 'README.md'), 'user edit\n', 'utf8');
    await git(ROOT, ['commit', '-am', 'user change']);

    const logPath = join(ROOT, '.pinagent', 'logs', `${id}.md`);
    const result = await agent.mergeWorktree(ROOT, id, logPath);

    expect(result.ok).toBe(false);
    expect(result.conflicts).toEqual(['README.md']);

    // Worktree and branch still on disk — user can resolve in editor.
    const wt = await git(ROOT, ['worktree', 'list']);
    expect(wt.stdout).toContain(id);
    const branches = await git(ROOT, ['branch', '--list', `pinagent/${id}`]);
    expect(branches.stdout).toContain(`pinagent/${id}`);

    // Main HEAD is back where it was — merge aborted.
    const status = await git(ROOT, ['status', '--porcelain']);
    expect(status.stdout.trim()).toBe('');

    // DB row stays 'active' so the user can retry.
    const rec = await storage.read(id);
    expect(rec?.worktreeState).toBe('active');
  });
});

describe('discardWorktree', () => {
  it('removes the worktree and branch', async () => {
    const storage = new storageMod.Storage(ROOT);
    const id = await makeFeedbackWithWorktree(storage);
    const worktreePath = await callCreateWorktree(id);
    await writeFile(join(worktreePath, 'README.md'), 'thrown away\n', 'utf8');

    const logPath = join(ROOT, '.pinagent', 'logs', `${id}.md`);
    const result = await agent.discardWorktree(ROOT, id, logPath);
    expect(result.ok).toBe(true);

    const wt = await git(ROOT, ['worktree', 'list']);
    expect(wt.stdout).not.toContain(id);
    const branches = await git(ROOT, ['branch', '--list', `pinagent/${id}`]);
    expect(branches.stdout.trim()).toBe('');

    const rec = await storage.read(id);
    expect(rec?.worktreeState).toBe('discarded');
  });

  it('is idempotent — discarding a row whose worktree is already gone still flips state', async () => {
    const storage = new storageMod.Storage(ROOT);
    const id = await makeFeedbackWithWorktree(storage);
    const worktreePath = await callCreateWorktree(id);

    // Remove the worktree out-of-band to simulate the user cleaning up
    // manually before clicking Discard.
    await git(ROOT, ['worktree', 'remove', '--force', worktreePath]);
    await git(ROOT, ['branch', '-D', `pinagent/${id}`]);

    const logPath = join(ROOT, '.pinagent', 'logs', `${id}.md`);
    const result = await agent.discardWorktree(ROOT, id, logPath);
    expect(result.ok).toBe(true);

    const rec = await storage.read(id);
    expect(rec?.worktreeState).toBe('discarded');
  });

  it('handles inline-mode rows (no worktree on disk) without error', async () => {
    const storage = new storageMod.Storage(ROOT);
    // Don't call createWorktree — leave the row as inline-mode.
    const id = await makeFeedbackWithWorktree(storage);

    const logPath = join(ROOT, '.pinagent', 'logs', `${id}.md`);
    const result = await agent.discardWorktree(ROOT, id, logPath);
    expect(result.ok).toBe(true);
    const rec = await storage.read(id);
    expect(rec?.worktreeState).toBe('discarded');
  });
});

// `createWorktree` isn't exported (it's a private helper). Reach it
// through the same path spawnAgent would — by setting up the feedback
// and patching the storage row directly with the worktree fields, then
// running `git worktree add` ourselves. Mirrors what createWorktree
// does so tests don't depend on its specific name/signature.
async function callCreateWorktree(feedbackId: string): Promise<string> {
  const storage = new storageMod.Storage(ROOT);
  const worktreeDir = join(ROOT, '.pinagent', 'worktrees');
  await mkdir(worktreeDir, { recursive: true });
  const worktreePath = join(worktreeDir, feedbackId);
  const branch = `pinagent/${feedbackId}`;
  await git(ROOT, ['worktree', 'add', '-b', branch, worktreePath]);
  await storage.patch(feedbackId, { branch, worktreePath, worktreeState: 'active' });
  return worktreePath;
}
