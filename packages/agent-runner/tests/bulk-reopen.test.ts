// SPDX-License-Identifier: Apache-2.0
/**
 * `reopenConversations` — multi-row re-open with a single bulk audit
 * event. Walks the real lifecycle (per-row goes through
 * `reopenConversation` from agent.ts), then pins the audit shape +
 * the reopened/failed split.
 */
import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

type StorageMod = typeof import('../src/storage');
type AgentMod = typeof import('../src/agent');
type AuditMod = typeof import('../src/audit-log');

let storageMod: StorageMod;
let agent: AgentMod;
let audit: AuditMod;

const ROOT = join(tmpdir(), `pa-bulk-reopen-${nanoid(8)}`);

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

async function seed(worktreeState: 'landed' | 'discarded' = 'landed'): Promise<string> {
  const id = nanoid(10);
  const storage = new storageMod.Storage(ROOT);
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
  await storage.patch(id, { worktreeState, status: 'fixed' });
  return id;
}

beforeAll(async () => {
  process.env.PINAGENT_PROJECT_ROOT = ROOT;
  process.env.NODE_ENV = 'production';
  await initFixtureRepo();
  storageMod = await import('../src/storage');
  agent = await import('../src/agent');
  audit = await import('../src/audit-log');
});

afterAll(async () => {
  await rm(ROOT, { recursive: true, force: true });
});

beforeEach(async () => {
  // Fresh state per test — no carryover from previous test's seeds.
  await rm(join(ROOT, '.pinagent', 'logs'), { recursive: true, force: true });
});

describe('reopenConversations', () => {
  it('re-opens N resolved conversations + emits ONE bulk audit event with the id list', async () => {
    const ids = await Promise.all([seed('landed'), seed('landed'), seed('discarded')]);
    const result = await agent.reopenConversations(ROOT, ids);

    expect(result.reopened.sort()).toEqual([...ids].sort());
    expect(result.failed).toEqual([]);

    // Storage rows should flip back to pending.
    const storage = new storageMod.Storage(ROOT);
    for (const id of ids) {
      const rec = await storage.read(id);
      expect(rec?.worktreeState).toBe('none');
      expect(rec?.status).toBe('pending');
    }

    const events = await audit.listAuditEvents(ROOT);
    const bulk = events.filter((e) => e.action === 'conversations_bulk_reopened');
    expect(bulk).toHaveLength(1);
    expect((bulk[0]?.payload as { count: number }).count).toBe(3);
    expect((bulk[0]?.payload as { ids: string[] }).ids.sort()).toEqual([...ids].sort());

    // Per-row `conversation_reopened` events still fire.
    const perRow = events.filter((e) => e.action === 'conversation_reopened');
    expect(perRow.length).toBeGreaterThanOrEqual(3);
  });

  it('puts unknown ids in failed[] without throwing', async () => {
    const id = await seed('landed');
    const result = await agent.reopenConversations(ROOT, [id, 'nonexistent_x']);
    expect(result.reopened).toEqual([id]);
    expect(result.failed.map((f) => f.feedbackId)).toEqual(['nonexistent_x']);
  });

  it('refuses to re-open non-resolved rows (active/pending)', async () => {
    const id = nanoid(10);
    const storage = new storageMod.Storage(ROOT);
    await storage.create(id, {
      comment: 'active fixture',
      loc: { file: 'README.md', line: 1, col: 1 },
      selector: 'h1',
      url: 'http://localhost:3000/',
      viewport: { w: 1280, h: 720 },
      userAgent: 'vitest',
      screenshot: TINY_PNG,
      createdAt: new Date().toISOString(),
    });
    // Leave at default (worktreeState='none', status='pending').
    const result = await agent.reopenConversations(ROOT, [id]);
    expect(result.reopened).toEqual([]);
    expect(result.failed[0]?.feedbackId).toBe(id);
    expect(result.failed[0]?.error).toContain('cannot reopen');
  });

  it('skips audit emit when nothing reopens', async () => {
    const beforeEvents = await audit.listAuditEvents(ROOT);
    const beforeBulk = beforeEvents.filter(
      (e) => e.action === 'conversations_bulk_reopened',
    ).length;
    const result = await agent.reopenConversations(ROOT, ['nonexistent_a', 'nonexistent_b']);
    expect(result.reopened).toEqual([]);
    const afterEvents = await audit.listAuditEvents(ROOT);
    const afterBulk = afterEvents.filter((e) => e.action === 'conversations_bulk_reopened').length;
    expect(afterBulk).toBe(beforeBulk);
  });
});
