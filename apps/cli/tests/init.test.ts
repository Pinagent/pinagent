// SPDX-License-Identifier: Apache-2.0
/**
 * Unit tests for `pinagent init`. The pure planners (gitignore, mcp.json,
 * route content, arg parsing) are tested directly; the fs-touching pieces
 * (detection, runInit) run against throwaway temp directories so no real
 * project is needed.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addDevDepCommand,
  detectPackageManager,
  detectRuntime,
  findAppDir,
  parseInitArgs,
  planGitignore,
  planMcpJson,
  pluginPackage,
  renderNextRoute,
  runInit,
} from '../src/init';

describe('parseInitArgs', () => {
  it('defaults dir to cwd and dryRun to false', () => {
    expect(parseInitArgs([], '/cwd')).toEqual({ dir: '/cwd', dryRun: false });
  });

  it('takes a positional dir', () => {
    expect(parseInitArgs(['/some/app'], '/cwd')).toEqual({ dir: '/some/app', dryRun: false });
  });

  it('supports --dir and -C', () => {
    expect(parseInitArgs(['--dir', '/x'], '/cwd')).toEqual({ dir: '/x', dryRun: false });
    expect(parseInitArgs(['-C', '/y'], '/cwd')).toEqual({ dir: '/y', dryRun: false });
  });

  it('supports --dry-run and -n', () => {
    expect(parseInitArgs(['--dry-run'], '/cwd')).toMatchObject({ dryRun: true });
    expect(parseInitArgs(['-n', '/app'], '/cwd')).toEqual({ dir: '/app', dryRun: true });
  });

  it('errors when --dir has no value', () => {
    expect(parseInitArgs(['--dir'], '/cwd')).toEqual({ error: '--dir requires a value' });
    expect(parseInitArgs(['--dir', '--dry-run'], '/cwd')).toEqual({
      error: '--dir requires a value',
    });
  });

  it('errors on unexpected extra positional', () => {
    expect(parseInitArgs(['/a', '/b'], '/cwd')).toEqual({ error: 'unexpected argument: /b' });
  });
});

describe('planGitignore', () => {
  it('creates content when the file is missing', () => {
    const r = planGitignore(null);
    expect(r.changed).toBe(true);
    expect(r.content).toContain('.pinagent');
    expect(r.content.startsWith('\n')).toBe(false);
  });

  it('appends with a separating newline when file lacks a trailing one', () => {
    const r = planGitignore('node_modules');
    expect(r.changed).toBe(true);
    expect(r.content).toBe(
      'node_modules\n# pinagent local feedback store (never commit)\n.pinagent\n',
    );
  });

  it('is a no-op when .pinagent is already ignored', () => {
    expect(planGitignore('node_modules\n.pinagent\n').changed).toBe(false);
  });

  it('treats a trailing-slash entry as already ignored', () => {
    expect(planGitignore('.pinagent/\n').changed).toBe(false);
  });
});

describe('planMcpJson', () => {
  it('creates a fresh config when the file is missing', () => {
    const r = planMcpJson(null);
    expect(r.changed).toBe(true);
    const parsed = JSON.parse(r.content);
    expect(parsed.mcpServers.pinagent).toEqual({
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@pinagent/cli', 'mcp'],
    });
  });

  it('merges into an existing config without clobbering other servers', () => {
    const r = planMcpJson(JSON.stringify({ mcpServers: { other: { command: 'x' } } }));
    expect(r.changed).toBe(true);
    const parsed = JSON.parse(r.content);
    expect(parsed.mcpServers.other).toEqual({ command: 'x' });
    expect(parsed.mcpServers.pinagent).toBeDefined();
  });

  it('preserves an existing pinagent entry (idempotent)', () => {
    const existing = JSON.stringify({ mcpServers: { pinagent: { command: 'custom' } } });
    expect(planMcpJson(existing).changed).toBe(false);
  });

  it('refuses to clobber unparseable JSON', () => {
    const r = planMcpJson('{ not json');
    expect(r.changed).toBe(false);
    expect(r.content).toBe('{ not json');
  });
});

describe('renderNextRoute', () => {
  it('declares dynamic/runtime inline and re-exports the handlers', () => {
    const out = renderNextRoute();
    expect(out).toContain("export const dynamic = 'force-dynamic';");
    expect(out).toContain("export const runtime = 'nodejs';");
    // Asserted as two fragments so the generated re-export line isn't a
    // contiguous import literal the undeclared-import linter would flag.
    expect(out).toContain('export { GET, POST, PATCH }');
    expect(out).toContain('@pinagent/next-plugin/route');
  });
});

describe('command helpers', () => {
  it('maps runtime to package', () => {
    expect(pluginPackage('vite')).toBe('@pinagent/vite-plugin');
    expect(pluginPackage('next')).toBe('@pinagent/next-plugin');
  });

  it('formats the add command per package manager', () => {
    expect(addDevDepCommand('pnpm', 'p')).toBe('pnpm add -D p');
    expect(addDevDepCommand('yarn', 'p')).toBe('yarn add -D p');
    expect(addDevDepCommand('bun', 'p')).toBe('bun add -d p');
    expect(addDevDepCommand('npm', 'p')).toBe('npm install -D p');
  });
});

describe('fs detection + runInit', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pinagent-init-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('detects vite, next, and unknown runtimes', () => {
    expect(detectRuntime(dir)).toBe('unknown');
    writeFileSync(join(dir, 'vite.config.ts'), '');
    expect(detectRuntime(dir)).toBe('vite');
    rmSync(join(dir, 'vite.config.ts'));
    writeFileSync(join(dir, 'next.config.mjs'), '');
    expect(detectRuntime(dir)).toBe('next');
  });

  it('detects the package manager from the lockfile', () => {
    expect(detectPackageManager(dir)).toBe('npm');
    writeFileSync(join(dir, 'pnpm-lock.yaml'), '');
    expect(detectPackageManager(dir)).toBe('pnpm');
  });

  it('finds app/ and src/app/', () => {
    expect(findAppDir(dir)).toBeNull();
    mkdirSync(join(dir, 'src', 'app'), { recursive: true });
    expect(findAppDir(dir)).toBe(join('src', 'app'));
    mkdirSync(join(dir, 'app'));
    expect(findAppDir(dir)).toBe('app');
  });

  it('returns code 1 and writes nothing for an unsupported project', () => {
    const r = runInit({ dir, dryRun: false });
    expect(r.code).toBe(1);
    expect(r.lines.join('\n')).toContain('no vite.config.* or next.config.*');
    expect(existsSync(join(dir, '.gitignore'))).toBe(false);
  });

  it('scaffolds a vite project (gitignore + mcp.json, no route file)', () => {
    writeFileSync(join(dir, 'vite.config.ts'), '');
    const r = runInit({ dir, dryRun: false });
    expect(r.code).toBe(0);
    expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toContain('.pinagent');
    expect(
      JSON.parse(readFileSync(join(dir, '.mcp.json'), 'utf8')).mcpServers.pinagent,
    ).toBeDefined();
    expect(r.lines.join('\n')).toContain('npm install -D @pinagent/vite-plugin');
  });

  it('scaffolds a next project including the route handler', () => {
    writeFileSync(join(dir, 'next.config.ts'), '');
    mkdirSync(join(dir, 'app'));
    const r = runInit({ dir, dryRun: false });
    expect(r.code).toBe(0);
    const route = readFileSync(join(dir, 'app', 'pinagent', '[[...slug]]', 'route.ts'), 'utf8');
    expect(route).toContain('@pinagent/next-plugin/route');
    expect(r.lines.join('\n')).toContain('<Pinagent />');
  });

  it('dry-run writes no files', () => {
    writeFileSync(join(dir, 'vite.config.ts'), '');
    const r = runInit({ dir, dryRun: true });
    expect(r.code).toBe(0);
    expect(existsSync(join(dir, '.gitignore'))).toBe(false);
    expect(existsSync(join(dir, '.mcp.json'))).toBe(false);
    expect(r.lines.join('\n')).toContain('dry run — no files were written');
  });

  it('is idempotent — a second run reports no changes', () => {
    writeFileSync(join(dir, 'vite.config.ts'), '');
    runInit({ dir, dryRun: false });
    const second = runInit({ dir, dryRun: false });
    const out = second.lines.join('\n');
    expect(out).toContain('already ignores .pinagent');
    expect(out).toContain('already has a pinagent server');
  });
});
