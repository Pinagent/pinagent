// SPDX-License-Identifier: Apache-2.0
/**
 * `pruneBranches` — multi-row worktree prune with a single bulk audit
 * event. Drives the real git path (each prune goes through
 * `discardWorktree` via the merge queue), then pins the audit shape
 * + the updated/skipped split.
 */
import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

type StorageMod = typeof import('../src/storage');
type BranchesMod = typeof import('../src/branches');
type AuditMod = typeof import('../src/audit-log');

let storageMod: StorageMod;
let branchesMod: BranchesMod;
let audit: AuditMod;

const ROOT = join(tmpdir(), `pa-bulk-prune-${nanoid(8)}`);

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

const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

async function seedWorktree(): Promise<string> {
  const storage = new storageMod.Storage(ROOT);
  const id = nanoid(10);
  await storage.create(id, {
    comment: 'fixture',
    loc: { file: 'README.md', line: 1, col: 1 },
    selector: 'h1',
    url: 'http://localhost:3000/',
    viewport: { w: 1280, h: 720 },
    userAgent: 'vitest',
    screenshot: TINY_PNG,
    createdAt: new Date().toISOString(),
  });
  const worktreeDir = join(ROOT, '.pinagent', 'worktrees');
  await mkdir(worktreeDir, { recursive: true });
  const worktreePath = join(worktreeDir, id);
  const branch = `pinagent/${id}`;
  await git(ROOT, ['worktree', 'add', '-b', branch, worktreePath]);
  await storage.patch(id, { branch, worktreePath, worktreeState: 'active' });
  return id;
}

beforeAll(async () => {
  process.env.PINAGENT_PROJECT_ROOT = ROOT;
  process.env.PINAGENT_SPAWN_AGENT = 'worktree';
  process.env.NODE_ENV = 'production';
  await initFixtureRepo();
  storageMod = await import('../src/storage');
  branchesMod = await import('../src/branches');
  audit = await import('../src/audit-log');
});

afterAll(async () => {
  await rm(ROOT, { recursive: true, force: true });
});

beforeEach(async () => {
  // Reset between tests so prior worktrees / branches don't leak.
  await git(ROOT, ['checkout', 'main']);
  await git(ROOT, ['reset', '--hard', 'HEAD']);
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

describe('pruneBranches', () => {
  it('prunes N worktrees + emits ONE bulk audit event with the id list', async () => {
    const ids = await Promise.all([seedWorktree(), seedWorktree(), seedWorktree()]);
    const result = await branchesMod.pruneBranches(ROOT, ids);

    expect(result.pruned.sort()).toEqual([...ids].sort());
    expect(result.failed).toEqual([]);

    // All worktrees should be gone.
    for (const id of ids) {
      const branchList = await git(ROOT, ['branch', '--list', `pinagent/${id}`]);
      expect(branchList.stdout.trim()).toBe('');
    }

    // Storage rows should show discarded.
    const storage = new storageMod.Storage(ROOT);
    for (const id of ids) {
      const rec = await storage.read(id);
      expect(rec?.worktreeState).toBe('discarded');
    }

    // Exactly one bulk audit event covering every id.
    const events = await audit.listAuditEvents(ROOT);
    const bulk = events.filter((e) => e.action === 'worktrees_bulk_pruned');
    expect(bulk).toHaveLength(1);
    expect((bulk[0]?.payload as { count: number }).count).toBe(3);
    expect((bulk[0]?.payload as { ids: string[] }).ids.sort()).toEqual([...ids].sort());

    // Per-row `conversation_discarded` events still fire (one per id)
    // so the per-conversation audit history stays intact.
    const perRow = events.filter((e) => e.action === 'conversation_discarded');
    expect(perRow).toHaveLength(3);
  });

  it('puts unknown ids in failed[] without throwing', async () => {
    const id = await seedWorktree();
    const result = await branchesMod.pruneBranches(ROOT, [id, 'nonexistent_x']);
    expect(result.pruned).toEqual([id]);
    expect(result.failed.map((f) => f.feedbackId)).toEqual(['nonexistent_x']);

    // Bulk audit event still emits, but only names the successful id.
    const events = await audit.listAuditEvents(ROOT);
    const bulk = events.find((e) => e.action === 'worktrees_bulk_pruned');
    expect((bulk?.payload as { ids: string[] }).ids).toEqual([id]);
    expect((bulk?.payload as { count: number }).count).toBe(1);
  });

  it('skips the audit emission when nothing was pruned', async () => {
    // Audit rows from prior tests persist (the DB is shared across the
    // suite); count the bulk events BEFORE the call and confirm the
    // count is unchanged after.
    const beforeEvents = await audit.listAuditEvents(ROOT);
    const beforeBulk = beforeEvents.filter((e) => e.action === 'worktrees_bulk_pruned').length;

    const result = await branchesMod.pruneBranches(ROOT, ['nonexistent_a', 'nonexistent_b']);
    expect(result.pruned).toEqual([]);
    expect(result.failed.map((f) => f.feedbackId).sort()).toEqual(
      ['nonexistent_a', 'nonexistent_b'].sort(),
    );
    const afterEvents = await audit.listAuditEvents(ROOT);
    const afterBulk = afterEvents.filter((e) => e.action === 'worktrees_bulk_pruned').length;
    expect(afterBulk).toBe(beforeBulk);
  });
});
