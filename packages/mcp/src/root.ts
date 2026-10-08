// SPDX-License-Identifier: Apache-2.0
import { type Dirent, existsSync, readdirSync, statSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';

/**
 * Resolve the project root by:
 *   1. Honoring PINAGENT_PROJECT_ROOT if set.
 *   2. Walking up from cwd looking for `.pinagent/`.
 *   3. Falling back to the nearest `package.json` ancestor.
 *   4. Falling back to cwd.
 */
export function resolveRoot(env: NodeJS.ProcessEnv, cwd: string): string {
  if (env.PINAGENT_PROJECT_ROOT) {
    return resolve(env.PINAGENT_PROJECT_ROOT);
  }

  const pinagentRoot = walkUp(cwd, (dir) => isDir(resolve(dir, '.pinagent')));
  if (pinagentRoot) return pinagentRoot;

  const pkgRoot = walkUp(cwd, (dir) => existsSync(resolve(dir, 'package.json')));
  if (pkgRoot) return pkgRoot;

  return cwd;
}

/**
 * Which project roots one MCP process serves.
 *
 * - `multi: false` — the classic single-root server. `roots` holds exactly
 *   the one root `resolveRoot` picked; tool schemas and output are
 *   byte-for-byte what they were before multi-root support existed.
 * - `multi: true` — opted in via `PINAGENT_PROJECT_ROOTS` and/or
 *   `PINAGENT_WORKSPACE_ROOT`. `roots` holds the explicit roots;
 *   `workspaceRoot` (when set) is scanned for further `.pinagent/` dirs by
 *   the caller (see `discoverProjectRoots`), so apps whose dev server first
 *   runs mid-session are picked up too.
 */
export interface ProjectRootsConfig {
  multi: boolean;
  roots: string[];
  workspaceRoot: string | null;
}

/**
 * Read the multi-root configuration from the environment.
 *
 *   PINAGENT_PROJECT_ROOTS   path-delimiter-separated list (`:` on POSIX,
 *                            `;` on Windows) of project roots — each one the
 *                            directory a dev server runs from, i.e. the
 *                            parent of a `.pinagent/`. Relative entries
 *                            resolve against `cwd`.
 *   PINAGENT_WORKSPACE_ROOT  a workspace (monorepo) root to scan for
 *                            `.pinagent/` dirs. Relative resolves against
 *                            `cwd`.
 *
 * When neither is set this is exactly the legacy single-root resolution.
 * When either is set, a `PINAGENT_PROJECT_ROOT` that is also present (a
 * spawned agent inherits one from its dev server) is folded in rather than
 * ignored, so the spawning app is always served.
 */
export function resolveProjectRoots(env: NodeJS.ProcessEnv, cwd: string): ProjectRootsConfig {
  const explicit = splitRoots(env.PINAGENT_PROJECT_ROOTS).map((p) => resolve(cwd, p));
  const workspaceRoot = env.PINAGENT_WORKSPACE_ROOT?.trim()
    ? resolve(cwd, env.PINAGENT_WORKSPACE_ROOT.trim())
    : null;
  if (explicit.length === 0 && !workspaceRoot) {
    return { multi: false, roots: [resolveRoot(env, cwd)], workspaceRoot: null };
  }
  if (env.PINAGENT_PROJECT_ROOT) explicit.push(resolve(env.PINAGENT_PROJECT_ROOT));
  return { multi: true, roots: dedupe(explicit), workspaceRoot };
}

function splitRoots(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(delimiter)
    .map((s) => s.trim())
    .filter(Boolean);
}

function dedupe(paths: string[]): string[] {
  return [...new Set(paths)];
}

/**
 * Directory names never descended into while scanning for `.pinagent/`.
 * Dot-directories (`.git`, `.claude`, `.next`, `.turbo`, `.pinagent`, …)
 * are skipped wholesale on top of these — that also keeps git worktrees
 * parked under `.claude/worktrees` or `.pinagent/worktrees` out of the scan,
 * since a worktree's `.pinagent/` belongs to the main checkout's dev server.
 */
const SKIP_DIRS = new Set([
  'node_modules',
  'worktrees',
  'dist',
  'build',
  'out',
  'coverage',
  'Pods',
  'vendor',
  'target',
]);

export interface DiscoverOptions {
  /** How many directory levels below the workspace root may hold a `.pinagent/`. */
  maxDepth?: number;
  /** Hard cap on directories visited, so a huge tree can't stall startup. */
  maxDirs?: number;
}

/**
 * Bounded breadth-first scan of `workspaceRoot` for directories containing
 * a `.pinagent/` directory. Returns them in BFS (then alphabetical) order.
 * Symlinks are not followed. Never throws — unreadable directories are
 * skipped.
 */
export function discoverProjectRoots(workspaceRoot: string, opts: DiscoverOptions = {}): string[] {
  const maxDepth = opts.maxDepth ?? 4;
  const maxDirs = opts.maxDirs ?? 5000;
  const found: string[] = [];
  let queue: string[] = [resolve(workspaceRoot)];
  let visited = 0;
  for (let depth = 0; depth <= maxDepth && queue.length > 0; depth++) {
    const next: string[] = [];
    for (const dir of queue) {
      if (++visited > maxDirs) return found;
      let entries: Dirent[];
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        if (e.name === '.pinagent') {
          found.push(dir);
          continue;
        }
        if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
        next.push(join(dir, e.name));
      }
    }
    queue = next;
  }
  return found;
}

function walkUp(start: string, predicate: (dir: string) => boolean): string | null {
  let dir = resolve(start);
  for (;;) {
    if (predicate(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}
