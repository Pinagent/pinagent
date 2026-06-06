// SPDX-License-Identifier: Apache-2.0
/**
 * Unit tests for `pinagent doctor`. Pure check functions run against
 * throwaway temp directories — no real project or install needed. The
 * resolution-dependent checks (`checkPluginInstalled`) are exercised only
 * on the deterministic "not installed" path, since a temp dir has no
 * node_modules to resolve against.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  checkConfigWired,
  checkDanglingSymlinks,
  checkGitignore,
  checkMcpJson,
  checkMiddlewareMatcher,
  checkPinagentMount,
  checkPluginInstalled,
  checkRouteHandler,
  checkRuntime,
  findWorkspaceRoot,
  parseDoctorArgs,
  runDoctor,
} from '../src/doctor';

// Built from a constant so the sample file contents below don't contain a
// contiguous `from '...'` literal the undeclared-import linter reads
// as a real import (the CLI doesn't depend on next-plugin).
const NP = '@pinagent/next-plugin';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pinagent-doctor-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const write = (rel: string, content: string) => {
  const abs = join(dir, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content);
};

describe('parseDoctorArgs', () => {
  it('defaults dir to cwd', () => {
    expect(parseDoctorArgs([], '/cwd')).toEqual({ dir: '/cwd' });
  });
  it('takes a positional and --dir/-C', () => {
    expect(parseDoctorArgs(['/app'], '/cwd')).toEqual({ dir: '/app' });
    expect(parseDoctorArgs(['--dir', '/x'], '/cwd')).toEqual({ dir: '/x' });
    expect(parseDoctorArgs(['-C', '/y'], '/cwd')).toEqual({ dir: '/y' });
  });
  it('errors on missing --dir value and extra positionals', () => {
    expect(parseDoctorArgs(['--dir'], '/cwd')).toEqual({ error: '--dir requires a value' });
    expect(parseDoctorArgs(['/a', '/b'], '/cwd')).toEqual({ error: 'unexpected argument: /b' });
  });
});

describe('checkRuntime', () => {
  it('fails when no runtime config is present', () => {
    expect(checkRuntime(dir).check.status).toBe('fail');
    expect(checkRuntime(dir).runtime).toBe('unknown');
  });
  it('detects next', () => {
    write('next.config.js', 'module.exports = {}');
    const r = checkRuntime(dir);
    expect(r.runtime).toBe('next');
    expect(r.check.status).toBe('ok');
  });
});

describe('checkPluginInstalled', () => {
  it('returns nothing for an unknown runtime', () => {
    expect(checkPluginInstalled(dir, 'unknown')).toEqual([]);
  });
  it('reports against the runtime plugin package', () => {
    // The resolution OUTCOME is environment-sensitive — under vitest a
    // workspace package resolves even from an unrelated temp dir, while
    // plain Node throws MODULE_NOT_FOUND. So assert the shape, not ok/fail;
    // the real resolve path is covered by the doctor smoke test against
    // examples/next-app.
    const checks = checkPluginInstalled(dir, 'next');
    expect(checks.length).toBeGreaterThan(0);
    expect(checks[0].label).toContain('@pinagent/next-plugin');
  });
});

describe('checkConfigWired', () => {
  it('passes when the config references pinagent', () => {
    write('next.config.js', `import pinagent from '${NP}/config';\nexport default pinagent({});`);
    expect(checkConfigWired(dir, 'next').status).toBe('ok');
  });
  it('fails when the config does not reference pinagent', () => {
    write('vite.config.ts', 'export default { plugins: [] }');
    expect(checkConfigWired(dir, 'vite').status).toBe('fail');
  });
  it('fails when no config file exists', () => {
    expect(checkConfigWired(dir, 'next').status).toBe('fail');
  });
});

describe('checkPinagentMount', () => {
  it('passes when imported and mounted', () => {
    write(
      'app/layout.tsx',
      `import { Pinagent } from '${NP}';\nexport default () => <body><Pinagent /></body>;`,
    );
    expect(checkPinagentMount(dir).status).toBe('ok');
  });
  it('fails when not mounted', () => {
    write('app/layout.tsx', 'export default () => <body />;');
    expect(checkPinagentMount(dir).status).toBe('fail');
  });
  it('warns when there is no app dir', () => {
    expect(checkPinagentMount(dir).status).toBe('warn');
  });
});

describe('checkRouteHandler', () => {
  const ROUTE = 'app/pinagent/[[...slug]]/route.ts';
  it('passes with inline dynamic/runtime + re-export', () => {
    write(
      ROUTE,
      `export const dynamic = 'force-dynamic';\nexport const runtime = 'nodejs';\nexport { GET, POST, PATCH } from '${NP}/route';`,
    );
    expect(checkRouteHandler(dir).status).toBe('ok');
  });
  it('fails when dynamic/runtime are not inline', () => {
    write(ROUTE, `export { GET, POST, PATCH } from '${NP}/route';`);
    expect(checkRouteHandler(dir).status).toBe('fail');
  });
  it('fails when the file is missing', () => {
    mkdirSync(join(dir, 'app'), { recursive: true });
    expect(checkRouteHandler(dir).status).toBe('fail');
  });
});

describe('checkMiddlewareMatcher', () => {
  it('skips when there is no middleware/proxy file', () => {
    expect(checkMiddlewareMatcher(dir).status).toBe('skip');
  });
  it('passes when the matcher excludes pinagent paths', () => {
    write(
      'middleware.ts',
      `export const config = { matcher: ['/((?!api|_next|__pinagent|pinagent|.*\\\\..*).*)'] };`,
    );
    expect(checkMiddlewareMatcher(dir).status).toBe('ok');
  });
  it('warns on a catch-all negative-lookahead matcher without pinagent', () => {
    write(
      'middleware.ts',
      `export const config = { matcher: ['/((?!api|_next|_vercel|.*\\\\..*).*)'] };`,
    );
    const r = checkMiddlewareMatcher(dir);
    expect(r.status).toBe('warn');
    expect(r.label).toContain('shadow');
  });
  it('warns when middleware has no matcher (runs on every request)', () => {
    write('proxy.ts', 'export default function proxy(req) { return; }');
    expect(checkMiddlewareMatcher(dir).status).toBe('warn');
  });
  it('finds the file under src/', () => {
    write('src/proxy.ts', `export const config = { matcher: ['/((?!api|_next|.*\\\\..*).*)'] };`);
    expect(checkMiddlewareMatcher(dir).status).toBe('warn');
  });
  it('does not warn on a scoped positive matcher', () => {
    write('middleware.ts', `export const config = { matcher: ['/dashboard/:path*'] };`);
    expect(checkMiddlewareMatcher(dir).status).toBe('ok');
  });
});

describe('checkGitignore', () => {
  it('passes when .pinagent is ignored at the root', () => {
    write('.gitignore', 'node_modules\n.pinagent\n');
    expect(checkGitignore(dir).status).toBe('ok');
  });
  it('passes when an ancestor .gitignore ignores it', () => {
    write('.gitignore', '.pinagent\n');
    mkdirSync(join(dir, 'apps', 'web'), { recursive: true });
    expect(checkGitignore(join(dir, 'apps', 'web')).status).toBe('ok');
  });
  it('warns when not ignored', () => {
    write('.gitignore', 'node_modules\n');
    expect(checkGitignore(dir).status).toBe('warn');
  });
});

describe('checkMcpJson', () => {
  it('warns when no .mcp.json exists', () => {
    expect(checkMcpJson(dir)[0].status).toBe('warn');
  });
  it('passes when a pinagent server is registered', () => {
    write('.mcp.json', JSON.stringify({ mcpServers: { pinagent: { command: 'pnpm' } } }));
    expect(checkMcpJson(dir)[0].status).toBe('ok');
  });
  it('fails when the server entry is missing', () => {
    write('.mcp.json', JSON.stringify({ mcpServers: { other: {} } }));
    expect(checkMcpJson(dir)[0].status).toBe('fail');
  });
  it('fails when PINAGENT_PROJECT_ROOT points nowhere', () => {
    write(
      '.mcp.json',
      JSON.stringify({
        mcpServers: {
          pinagent: { command: 'pnpm', env: { PINAGENT_PROJECT_ROOT: '/no/such/dir' } },
        },
      }),
    );
    const checks = checkMcpJson(dir);
    expect(checks.some((c) => c.status === 'fail')).toBe(true);
  });
  it('warns when .mcp.json sits inside an app in a monorepo', () => {
    write('pnpm-workspace.yaml', "packages:\n  - 'apps/*'\n");
    write('apps/web/.mcp.json', JSON.stringify({ mcpServers: { pinagent: { command: 'pnpm' } } }));
    const checks = checkMcpJson(join(dir, 'apps', 'web'));
    expect(checks.some((c) => c.status === 'warn' && /monorepo root/.test(c.detail ?? ''))).toBe(
      true,
    );
  });
  it('does not warn when .mcp.json is at the monorepo root', () => {
    write('pnpm-workspace.yaml', "packages:\n  - 'apps/*'\n");
    write('.mcp.json', JSON.stringify({ mcpServers: { pinagent: { command: 'pnpm' } } }));
    mkdirSync(join(dir, 'apps', 'web'), { recursive: true });
    const checks = checkMcpJson(join(dir, 'apps', 'web'));
    expect(checks.every((c) => c.status !== 'warn')).toBe(true);
  });
  it('points a missing-config warning at the monorepo root', () => {
    write('pnpm-workspace.yaml', "packages:\n  - 'apps/*'\n");
    mkdirSync(join(dir, 'apps', 'web'), { recursive: true });
    const checks = checkMcpJson(join(dir, 'apps', 'web'));
    expect(checks[0].status).toBe('warn');
    expect(checks[0].detail).toMatch(/monorepo root/);
  });
});

describe('findWorkspaceRoot', () => {
  it('returns null for a single-package repo', () => {
    write('package.json', JSON.stringify({ name: 'solo' }));
    expect(findWorkspaceRoot(dir)).toBeNull();
  });
  it('finds a pnpm-workspace.yaml from a nested app', () => {
    write('pnpm-workspace.yaml', "packages:\n  - 'apps/*'\n");
    mkdirSync(join(dir, 'apps', 'web'), { recursive: true });
    expect(findWorkspaceRoot(join(dir, 'apps', 'web'))).toBe(dir);
  });
  it('finds a package.json with a workspaces field', () => {
    write('package.json', JSON.stringify({ name: 'mono', workspaces: ['apps/*'] }));
    mkdirSync(join(dir, 'apps', 'web'), { recursive: true });
    expect(findWorkspaceRoot(join(dir, 'apps', 'web'))).toBe(dir);
  });
});

describe('checkDanglingSymlinks', () => {
  it('skips when there is no @pinagent scope', () => {
    expect(checkDanglingSymlinks(dir).status).toBe('skip');
  });
  it('flags a broken symlink', () => {
    const scope = join(dir, 'node_modules', '@pinagent');
    mkdirSync(scope, { recursive: true });
    symlinkSync(join(dir, 'does-not-exist'), join(scope, 'next'));
    const r = checkDanglingSymlinks(dir);
    expect(r.status).toBe('fail');
    expect(r.label).toContain('@pinagent/next');
  });
});

describe('runDoctor', () => {
  it('returns a non-zero code when checks fail', () => {
    write('next.config.js', 'module.exports = {}'); // no pinagent reference
    const r = runDoctor(dir);
    expect(r.code).toBe(1);
    expect(r.lines.join('\n')).toContain('pinagent doctor');
  });
});
