// SPDX-License-Identifier: Apache-2.0
/**
 * `pinagent doctor` — verify that pinagent is wired into a project correctly.
 *
 * The inverse of `pinagent init`: instead of scaffolding, it inspects an
 * already-wired project and reports what's right, what's missing, and what
 * looks broken. It replaces the handful of one-off `node -e`/`ls` probes you
 * otherwise run when "the widget didn't show up" — every check below came
 * from a real setup snag:
 *
 *   - plugin installed AND its subpath exports (`./config`, `./route`)
 *     actually resolve from the project (a half-published tarball, or a
 *     stale `@pinagent/*` symlink, resolves the root but not the subpaths),
 *   - the runtime config is wrapped with `pinagent(...)`,
 *   - `<Pinagent />` is mounted (Next),
 *   - the route handler exists with inline `dynamic`/`runtime` (Next),
 *   - `.pinagent` is gitignored,
 *   - `.mcp.json` registers the server and any `PINAGENT_PROJECT_ROOT` it
 *     pins points at a directory that exists — and, in a monorepo, that it
 *     lives at the repo root rather than buried inside one app,
 *   - no dangling `@pinagent/*` symlinks linger in node_modules from an
 *     earlier, abandoned install attempt.
 *
 * Everything is read-only — doctor never writes. Pure check functions take a
 * `root` and return structured `Check`s so the unit tests can pin behaviour
 * against throwaway temp dirs, the same split `init.ts` uses.
 */
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve, sep } from 'node:path';
import { detectRuntime, findAppDir, pluginPackage, type Runtime } from './init';

// Reference the plugin package through a constant rather than a contiguous
// `from '...'` literal in the doc strings below: the CLI resolves
// next-plugin from the *user's* project, it doesn't import it. This keeps the
// undeclared-import linter from reading these messages as a real dependency
// (same dodge as init.ts's `routeModule`).
const NP = '@pinagent/next-plugin';

export type CheckStatus = 'ok' | 'warn' | 'fail' | 'skip';

export interface Check {
  status: CheckStatus;
  label: string;
  /** Optional second line with remediation or extra context. */
  detail?: string;
}

const VITE_CONFIGS = ['vite.config.ts', 'vite.config.js', 'vite.config.mjs', 'vite.config.mts'];
const NEXT_CONFIGS = [
  'next.config.ts',
  'next.config.js',
  'next.config.mjs',
  'next.config.mts',
  'next.config.cjs',
];
const NUXT_CONFIGS = ['nuxt.config.ts', 'nuxt.config.js', 'nuxt.config.mjs', 'nuxt.config.mts'];
const LAYOUT_FILES = ['layout.tsx', 'layout.jsx', 'layout.ts', 'layout.js'];

function firstExisting(root: string, names: string[]): string | null {
  for (const n of names) {
    if (existsSync(join(root, n))) return n;
  }
  return null;
}

const read = (path: string): string | null =>
  existsSync(path) ? readFileSync(path, 'utf8') : null;

/**
 * Can `specifier` be resolved with Node's algorithm rooted at `root`? Used
 * to verify both the plugin package and its subpath exports actually load —
 * a stale symlink or a tarball missing `dist/` resolves the bare package but
 * throws on the subpath, which is exactly the failure we want to surface.
 */
export function canResolveFrom(root: string, specifier: string): boolean {
  try {
    const require = createRequire(join(resolve(root), 'package.json'));
    require.resolve(specifier);
    return true;
  } catch {
    return false;
  }
}

/** Detect runtime; `unknown` is a hard fail since nothing downstream applies. */
export function checkRuntime(root: string): { runtime: Runtime; check: Check } {
  const runtime = detectRuntime(root);
  if (runtime === 'unknown') {
    return {
      runtime,
      check: {
        status: 'fail',
        label: 'No supported runtime detected',
        detail:
          'Expected a vite.config.*, next.config.*, or nuxt.config.* — run doctor from the app root (--dir).',
      },
    };
  }
  return { runtime, check: { status: 'ok', label: `Runtime: ${runtime}` } };
}

/** Plugin package resolves, and (for Next) its `./config` + `./route` subpaths do too. */
export function checkPluginInstalled(root: string, runtime: Runtime): Check[] {
  if (runtime === 'unknown') return [];
  const pkg = pluginPackage(runtime);
  // Resolve the bare package (its `.` export), not `${pkg}/package.json` —
  // the plugins' `exports` maps don't expose `./package.json`, so resolving
  // that path throws ERR_PACKAGE_PATH_NOT_EXPORTED even when installed.
  if (!canResolveFrom(root, pkg)) {
    return [
      {
        status: 'fail',
        label: `${pkg} is not installed`,
        detail: `Install it: pnpm add -D ${pkg}`,
      },
    ];
  }
  const checks: Check[] = [{ status: 'ok', label: `${pkg} resolves` }];
  if (runtime === 'next') {
    for (const subpath of ['config', 'route']) {
      const ok = canResolveFrom(root, `${pkg}/${subpath}`);
      checks.push(
        ok
          ? { status: 'ok', label: `${pkg}/${subpath} resolves` }
          : {
              status: 'fail',
              label: `${pkg}/${subpath} does not resolve`,
              detail:
                'The package resolves but this subpath export is missing — likely a stale/partial install. Reinstall the plugin.',
            },
      );
    }
  }
  return checks;
}

/** The runtime config file references `pinagent`. */
export function checkConfigWired(root: string, runtime: Runtime): Check {
  const names =
    runtime === 'next' ? NEXT_CONFIGS : runtime === 'nuxt' ? NUXT_CONFIGS : VITE_CONFIGS;
  const file = firstExisting(root, names);
  if (!file) {
    return {
      status: 'fail',
      label: 'Config file not found',
      detail: `Expected one of: ${names.join(', ')}`,
    };
  }
  const content = read(join(root, file)) ?? '';
  const wired = content.includes('pinagent');
  return wired
    ? { status: 'ok', label: `${file} references pinagent` }
    : {
        status: 'fail',
        label: `${file} does not wrap pinagent`,
        detail:
          runtime === 'nuxt'
            ? "Add '@pinagent/nuxt-plugin' to the modules array."
            : runtime === 'next'
              ? `Wrap your config: export default pinagent(nextConfig) (import from '${NP}/config').`
              : 'Add pinagent() to the Vite plugins array.',
      };
}

/** Next only: `<Pinagent />` is imported and mounted in the root layout. */
export function checkPinagentMount(root: string): Check {
  const appDir = findAppDir(root);
  if (!appDir) {
    return {
      status: 'warn',
      label: 'No app/ directory found',
      detail: 'Cannot verify <Pinagent /> mount.',
    };
  }
  const layout = firstExisting(join(root, appDir), LAYOUT_FILES);
  if (!layout) {
    return {
      status: 'warn',
      label: `No root layout in ${appDir}/`,
      detail: 'Cannot verify <Pinagent /> mount.',
    };
  }
  const content = read(join(root, appDir, layout)) ?? '';
  const imported = /['"]@pinagent\/next-plugin['"]/.test(content);
  const mounted = /<Pinagent\b/.test(content);
  if (imported && mounted) {
    return { status: 'ok', label: `<Pinagent /> mounted in ${appDir}/${layout}` };
  }
  return {
    status: 'fail',
    label: `<Pinagent /> not mounted in ${appDir}/${layout}`,
    detail: `Add import { Pinagent } from '${NP}' and render <Pinagent /> as the last child of <body>.`,
  };
}

/** Next only: the route handler exists with inline dynamic/runtime + the re-export. */
export function checkRouteHandler(root: string): Check {
  const appDir = findAppDir(root);
  if (!appDir) {
    return {
      status: 'warn',
      label: 'No app/ directory found',
      detail: 'Cannot verify the route handler.',
    };
  }
  const base = join(root, appDir, 'pinagent', '[[...slug]]');
  const file = firstExisting(base, ['route.ts', 'route.js']);
  if (!file) {
    return {
      status: 'fail',
      label: `Missing ${appDir}/pinagent/[[...slug]]/route.ts`,
      detail:
        'Create it (pinagent init writes it) — re-exports the request handlers from @pinagent/next-plugin/route.',
    };
  }
  const content = read(join(base, file)) ?? '';
  const hasInlineConfig =
    /export\s+const\s+dynamic\b/.test(content) && /export\s+const\s+runtime\b/.test(content);
  const hasReExport = /@pinagent\/next-plugin\/route/.test(content);
  if (hasInlineConfig && hasReExport) {
    return { status: 'ok', label: `Route handler wired (${appDir}/pinagent/[[...slug]]/${file})` };
  }
  return {
    status: 'fail',
    label: 'Route handler is incomplete',
    detail: hasReExport
      ? 'dynamic/runtime must be declared inline — Next refuses to follow a re-export for those segment-config fields.'
      : 'It must re-export GET/POST/PATCH (+ PUT/DELETE for the dock) from @pinagent/next-plugin/route.',
  };
}

/** `.pinagent` is ignored by a .gitignore at the project root or any ancestor. */
export function checkGitignore(root: string): Check {
  let dir = resolve(root);
  for (;;) {
    const gi = read(join(dir, '.gitignore'));
    if (gi) {
      const ignored = gi.split('\n').some((l) => l.trim().replace(/\/+$/, '') === '.pinagent');
      if (ignored) {
        return { status: 'ok', label: `.pinagent gitignored (${join(dir, '.gitignore')})` };
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return {
    status: 'warn',
    label: '.pinagent is not gitignored',
    detail:
      "Add '.pinagent' to .gitignore (monorepo root, not just the app) — it's a local store and must never be committed.",
  };
}

/**
 * The outermost ancestor of `root` (inclusive) that looks like a pnpm/npm/yarn
 * workspace root — a `pnpm-workspace.yaml`, a `package.json` with a
 * `workspaces` field, or a `lerna.json`. Returns the highest such directory so
 * the answer is the monorepo root, not an intermediate nested workspace; `null`
 * for a single-package repo. Used to recommend registering the MCP server at
 * the repo root rather than inside one app.
 */
export function findWorkspaceRoot(root: string): string | null {
  let dir = resolve(root);
  let outermost: string | null = null;
  for (;;) {
    const hasPnpmWs = existsSync(join(dir, 'pnpm-workspace.yaml'));
    const hasLerna = existsSync(join(dir, 'lerna.json'));
    let hasNpmWs = false;
    const pkg = read(join(dir, 'package.json'));
    if (pkg) {
      try {
        hasNpmWs = (JSON.parse(pkg) as { workspaces?: unknown }).workspaces !== undefined;
      } catch {
        // ignore a malformed package.json — treat as no workspaces marker
      }
    }
    if (hasPnpmWs || hasLerna || hasNpmWs) outermost = dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return outermost;
}

/** `.mcp.json` registers a pinagent server; a pinned PINAGENT_PROJECT_ROOT exists. */
export function checkMcpJson(root: string): Check[] {
  const workspaceRoot = findWorkspaceRoot(root);
  let dir = resolve(root);
  let found: { path: string; content: string } | null = null;
  for (;;) {
    const content = read(join(dir, '.mcp.json'));
    if (content) {
      found = { path: join(dir, '.mcp.json'), content };
      break;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (!found) {
    return [
      {
        status: 'warn',
        label: 'No .mcp.json found',
        detail: workspaceRoot
          ? `Register at the monorepo root (${workspaceRoot}) so one agent session covers the whole workspace: cd ${workspaceRoot} && claude mcp add pinagent -s project -- pnpm dlx @pinagent/cli mcp (then pin PINAGENT_PROJECT_ROOT to this app).`
          : 'Register the server: claude mcp add pinagent -s project -- pnpm dlx @pinagent/cli mcp',
      },
    ];
  }
  let parsed: { mcpServers?: Record<string, { env?: Record<string, string> }> };
  try {
    parsed = JSON.parse(found.content);
  } catch {
    return [{ status: 'fail', label: `${found.path} is not valid JSON` }];
  }
  const server = parsed.mcpServers?.pinagent;
  if (!server) {
    return [
      {
        status: 'fail',
        label: `${found.path} has no "pinagent" MCP server`,
        detail: 'Add a pinagent entry under mcpServers (see pinagent init).',
      },
    ];
  }
  const checks: Check[] = [{ status: 'ok', label: `pinagent registered in ${found.path}` }];
  // In a monorepo, prefer one `.mcp.json` at the repo root over a per-app one:
  // a single agent session can then edit the app AND the shared packages a fix
  // usually touches. Warn (not fail) when it sits below the detected root — it
  // still works, but only covers that app.
  if (workspaceRoot) {
    const foundDir = resolve(dirname(found.path));
    if (foundDir.startsWith(resolve(workspaceRoot) + sep)) {
      checks.push({
        status: 'warn',
        label: '.mcp.json is inside an app, not the monorepo root',
        detail: `Prefer registering at the monorepo root (${workspaceRoot}) so one agent session covers the whole workspace; keep PINAGENT_PROJECT_ROOT pointed at this app.`,
      });
    }
  }
  const pinned = server.env?.PINAGENT_PROJECT_ROOT;
  if (pinned !== undefined) {
    checks.push(
      existsSync(pinned)
        ? { status: 'ok', label: `PINAGENT_PROJECT_ROOT exists (${pinned})` }
        : {
            status: 'fail',
            label: 'PINAGENT_PROJECT_ROOT points at a missing directory',
            detail: `${pinned} does not exist — it must match where your dev server runs from.`,
          },
    );
  }
  return checks;
}

/** Broken `@pinagent/*` symlinks in node_modules — leftovers from an aborted install. */
export function checkDanglingSymlinks(root: string): Check {
  const scope = join(resolve(root), 'node_modules', '@pinagent');
  if (!existsSync(scope)) {
    return { status: 'skip', label: 'No @pinagent/* packages in node_modules (nothing to check)' };
  }
  const dangling: string[] = [];
  for (const name of readdirSync(scope)) {
    const entry = join(scope, name);
    try {
      if (lstatSync(entry).isSymbolicLink()) {
        // realpathSync throws (or the target is gone) for a broken link.
        realpathSync(entry);
        if (!existsSync(entry)) dangling.push(`@pinagent/${name}`);
      }
    } catch {
      dangling.push(`@pinagent/${name}`);
    }
  }
  if (dangling.length === 0) {
    return { status: 'ok', label: 'No dangling @pinagent/* symlinks' };
  }
  return {
    status: 'fail',
    label: `Dangling @pinagent/* symlink(s): ${dangling.join(', ')}`,
    detail:
      'Left over from an earlier/renamed install. Remove them (rm the broken links) and reinstall.',
  };
}

export interface DoctorResult {
  /** 0 = all good (only ok/warn/skip), 1 = at least one hard failure. */
  code: number;
  lines: string[];
}

const SYMBOL: Record<CheckStatus, string> = { ok: '✓', warn: '!', fail: '✗', skip: '·' };

/**
 * Run every check against `root` and render a report. Read-only; returns the
 * lines + an exit code so the caller (and tests) stay free of stdout.
 */
export function runDoctor(root: string): DoctorResult {
  const { runtime, check: runtimeCheck } = checkRuntime(root);
  const checks: Check[] = [runtimeCheck];

  if (runtime !== 'unknown') {
    checks.push(...checkPluginInstalled(root, runtime));
    checks.push(checkConfigWired(root, runtime));
    if (runtime === 'next') {
      checks.push(checkPinagentMount(root));
      checks.push(checkRouteHandler(root));
    }
  }
  checks.push(checkGitignore(root));
  checks.push(...checkMcpJson(root));
  checks.push(checkDanglingSymlinks(root));

  const lines: string[] = [];
  lines.push(`pinagent doctor — ${resolve(root)}`);
  lines.push('');
  for (const c of checks) {
    lines.push(`  ${SYMBOL[c.status]} ${c.label}`);
    if (c.detail) lines.push(`      ${c.detail}`);
  }

  const failures = checks.filter((c) => c.status === 'fail').length;
  const warnings = checks.filter((c) => c.status === 'warn').length;
  lines.push('');
  if (failures > 0) {
    lines.push(`${failures} problem(s) found${warnings ? `, ${warnings} warning(s)` : ''}.`);
  } else if (warnings > 0) {
    lines.push(`No problems, ${warnings} warning(s) — pinagent should work.`);
  } else {
    lines.push('All checks passed — pinagent is wired correctly.');
  }
  return { code: failures > 0 ? 1 : 0, lines };
}

export interface DoctorArgs {
  dir: string;
}

/** Parse argv for `pinagent doctor`. Mirrors parseInitArgs' --dir/-C handling. */
export function parseDoctorArgs(
  argv: string[],
  cwd: string = process.cwd(),
): DoctorArgs | { error: string } {
  let dir: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dir' || arg === '-C') {
      const next = argv[i + 1];
      if (!next || next.startsWith('-')) return { error: `${arg} requires a value` };
      dir = next;
      i++;
    } else if (arg && !arg.startsWith('-') && dir === null) {
      dir = arg;
    } else {
      return { error: `unexpected argument: ${arg}` };
    }
  }
  return { dir: dir ?? cwd };
}
