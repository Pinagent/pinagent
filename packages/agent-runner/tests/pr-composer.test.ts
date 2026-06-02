// SPDX-License-Identifier: Apache-2.0
/**
 * `ComposeOptsSchema` validation + `composePullRequest` guard paths
 * (src/pr-composer.ts). The compose happy-path needs a real remote + a
 * GitHub token, so it's left to integration coverage; here we pin the
 * input contract and every early-return that protects git state before
 * the first worktree-add — these are what stop a half-built compose
 * branch from a stale multi-select.
 */
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ComposeOptsSchema, composePullRequest } from '../src/pr-composer';
import { Storage } from '../src/storage';

const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

const validOpts = () => ({
  feedbackIds: ['abc123'],
  branchName: 'pinagent/batch-3a8e',
  title: 'Batch fix',
  description: 'Some changes',
  baseBranch: 'main',
});

describe('ComposeOptsSchema', () => {
  it('accepts a well-formed payload', () => {
    expect(ComposeOptsSchema.safeParse(validOpts()).success).toBe(true);
  });

  it('rejects an empty feedbackIds list', () => {
    expect(ComposeOptsSchema.safeParse({ ...validOpts(), feedbackIds: [] }).success).toBe(false);
  });

  it('rejects more than 50 feedbackIds', () => {
    const tooMany = Array.from({ length: 51 }, (_, i) => `id-${i}`);
    expect(ComposeOptsSchema.safeParse({ ...validOpts(), feedbackIds: tooMany }).success).toBe(
      false,
    );
  });

  it('rejects a branch name with illegal characters', () => {
    expect(ComposeOptsSchema.safeParse({ ...validOpts(), branchName: 'bad branch!' }).success).toBe(
      false,
    );
  });

  it('rejects an empty title', () => {
    expect(ComposeOptsSchema.safeParse({ ...validOpts(), title: '' }).success).toBe(false);
  });
});

describe('composePullRequest guard paths', () => {
  let root: string;

  async function seedConversation(
    worktreeState: 'none' | 'active' | 'landed' = 'landed',
  ): Promise<string> {
    const id = nanoid(10);
    const storage = new Storage(root);
    await storage.create(id, {
      comment: 'fixture',
      loc: { file: 'file.txt', line: 1, col: 1 },
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
    root = await mkdtemp(join(tmpdir(), 'pa-prcompose-'));
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
    await writeFile(join(root, '.gitignore'), '.pinagent/\n');
    await writeFile(join(root, 'file.txt'), 'a\n');
    execFileSync('git', ['add', '-A'], { cwd: root });
    execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: root });
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('fails when no conversations are selected', async () => {
    const result = await composePullRequest(root, { ...validOpts(), feedbackIds: [] });
    expect(result.ok).toBe(false);
    expect(result.branchPushed).toBe(false);
    expect(result.error).toMatch(/no conversations selected/);
  });

  it('fails on an invalid branch name', async () => {
    const result = await composePullRequest(root, { ...validOpts(), branchName: 'bad branch!' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/invalid branch name/);
  });

  it('fails when the project root is not a git repository', async () => {
    const notRepo = await mkdtemp(join(tmpdir(), 'pa-notrepo-'));
    try {
      const result = await composePullRequest(notRepo, validOpts());
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/not a git repository/);
    } finally {
      await rm(notRepo, { recursive: true, force: true });
    }
  });

  it('fails when a selected conversation does not exist', async () => {
    const result = await composePullRequest(root, { ...validOpts(), feedbackIds: ['ghost_id'] });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/conversation not found: ghost_id/);
  });

  it('refuses a conversation that is not in the active worktree state', async () => {
    const id = await seedConversation('landed');
    const result = await composePullRequest(root, { ...validOpts(), feedbackIds: [id] });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/only active conversations can be composed/);
  });

  it('reports an active conversation that has no worktree (inline-mode submission)', async () => {
    const id = await seedConversation('active'); // active but never got a worktreePath/branch
    const result = await composePullRequest(root, { ...validOpts(), feedbackIds: [id] });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no worktree \(inline-mode submission\)/);
  });
});
