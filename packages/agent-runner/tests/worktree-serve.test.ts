// SPDX-License-Identifier: Apache-2.0
/**
 * `resolveServeCommand` — the override-vs-inference decision for launching a
 * worktree's on-demand dev server. Pure aside from reading the worktree's
 * package.json + lockfile, so each case writes a throwaway dir.
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveServeCommand } from '../src/worktree-serve';

const PARENT = join(tmpdir(), `pa-serve-${nanoid(8)}`);

interface Fixture {
  pkg?: Record<string, unknown>;
  lockfile?: string;
}

async function freshWorktree(fixture: Fixture): Promise<string> {
  const dir = join(PARENT, nanoid(8));
  await mkdir(dir, { recursive: true });
  if (fixture.pkg) await writeFile(join(dir, 'package.json'), JSON.stringify(fixture.pkg));
  if (fixture.lockfile) await writeFile(join(dir, fixture.lockfile), '');
  return dir;
}

beforeAll(async () => {
  await mkdir(PARENT, { recursive: true });
});

afterAll(async () => {
  await rm(PARENT, { recursive: true, force: true });
});

describe('resolveServeCommand', () => {
  describe('override', () => {
    it('substitutes a {port} placeholder', async () => {
      const worktreePath = await freshWorktree({});
      expect(
        resolveServeCommand({ worktreePath, port: 53710, override: 'pnpm dev --port {port}' }),
      ).toBe('pnpm dev --port 53710');
    });

    it('substitutes every {port} occurrence', async () => {
      const worktreePath = await freshWorktree({});
      expect(
        resolveServeCommand({
          worktreePath,
          port: 4000,
          override: 'PORT={port} pnpm dev --port {port}',
        }),
      ).toBe('PORT=4000 pnpm dev --port 4000');
    });

    it('appends --port when the override has no placeholder', async () => {
      const worktreePath = await freshWorktree({});
      expect(resolveServeCommand({ worktreePath, port: 4000, override: 'pnpm dev' })).toBe(
        'pnpm dev --port 4000',
      );
    });

    it('wins over package.json inference', async () => {
      const worktreePath = await freshWorktree({
        pkg: { scripts: { dev: 'vite' }, devDependencies: { vite: '^5' } },
        lockfile: 'pnpm-lock.yaml',
      });
      expect(
        resolveServeCommand({ worktreePath, port: 5000, override: 'custom serve {port}' }),
      ).toBe('custom serve 5000');
    });

    it('ignores a blank override and falls through to inference', async () => {
      const worktreePath = await freshWorktree({
        pkg: { scripts: { dev: 'vite' } },
        lockfile: 'pnpm-lock.yaml',
      });
      expect(resolveServeCommand({ worktreePath, port: 5173, override: '   ' })).toBe(
        'pnpm run dev -- --port 5173',
      );
    });
  });

  describe('inference', () => {
    it('uses --port + pnpm for a Vite project with a pnpm lockfile', async () => {
      const worktreePath = await freshWorktree({
        pkg: { scripts: { dev: 'vite' }, devDependencies: { vite: '^5' } },
        lockfile: 'pnpm-lock.yaml',
      });
      expect(resolveServeCommand({ worktreePath, port: 5173 })).toBe('pnpm run dev -- --port 5173');
    });

    it('uses -p for a Next project and defaults to npm without a lockfile', async () => {
      const worktreePath = await freshWorktree({
        pkg: { scripts: { dev: 'next dev' }, dependencies: { next: '^15' } },
      });
      expect(resolveServeCommand({ worktreePath, port: 3001 })).toBe('npm run dev -- -p 3001');
    });

    it('forwards args without `--` for yarn', async () => {
      const worktreePath = await freshWorktree({
        pkg: { scripts: { dev: 'vite' }, devDependencies: { vite: '^5' } },
        lockfile: 'yarn.lock',
      });
      expect(resolveServeCommand({ worktreePath, port: 5173 })).toBe('yarn dev --port 5173');
    });

    it('uses bun when a bun lockfile is present', async () => {
      const worktreePath = await freshWorktree({
        pkg: { scripts: { dev: 'vite' } },
        lockfile: 'bun.lockb',
      });
      expect(resolveServeCommand({ worktreePath, port: 5173 })).toBe('bun run dev -- --port 5173');
    });

    it('falls back to the start script when there is no dev script', async () => {
      const worktreePath = await freshWorktree({
        pkg: { scripts: { start: 'next start' }, dependencies: { next: '^15' } },
        lockfile: 'pnpm-lock.yaml',
      });
      expect(resolveServeCommand({ worktreePath, port: 3000 })).toBe('pnpm run start -- -p 3000');
    });

    it('returns null when package.json is missing', async () => {
      const worktreePath = await freshWorktree({});
      expect(resolveServeCommand({ worktreePath, port: 3000 })).toBeNull();
    });

    it('returns null when there is no dev or start script', async () => {
      const worktreePath = await freshWorktree({
        pkg: { scripts: { build: 'vite build' } },
        lockfile: 'pnpm-lock.yaml',
      });
      expect(resolveServeCommand({ worktreePath, port: 3000 })).toBeNull();
    });
  });
});
