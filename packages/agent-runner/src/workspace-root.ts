// SPDX-License-Identifier: Apache-2.0
import { existsSync, readFileSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { runGitCapture } from './git-utils';

/**
 * Extra directories the spawned agent may read (and, in `acceptEdits`, edit)
 * without a permission prompt, beyond its own `cwd`.
 *
 * In a monorepo the dev server — and therefore the agent's `cwd` — is the app
 * subdirectory (`<repo>/apps/web`). Sibling workspace packages
 * (`<repo>/packages/ui/...`) sit outside that directory, so every read of
 * them needs a permission prompt. A headless run has nobody to answer it, so
 * the read is silently denied and the agent burns turns retrying it through
 * Read / cat / find / node_modules symlinks before giving up. Granting the
 * enclosing repository root up front lets it follow imports across the
 * workspace.
 *
 * The root is the git toplevel of `cwd`, falling back to the nearest ancestor
 * carrying a workspace marker (`pnpm-workspace.yaml`, or a `package.json`
 * with `workspaces`) only when `cwd` isn't in a git repo at all. For a pinagent-created
 * worktree the toplevel is the worktree itself (git resolves a linked
 * worktree's own root, never the primary checkout's), which equals `cwd`, so
 * nothing is added and the agent stays confined to its worktree.
 *
 * Returns `[]` when the root is `cwd` itself, the filesystem root, the home
 * directory (or an ancestor of it — e.g. a dotfiles repo at `~`), or when
 * anything goes wrong. Never throws.
 */
export async function resolveWorkspaceAdditionalDirectories(cwd: string): Promise<string[]> {
  try {
    const realCwd = await realpath(cwd);
    const home = await realpath(homedir()).catch(() => resolve(homedir()));
    // Inside git, the toplevel is authoritative: when it's rejected (e.g. it
    // equals `cwd` for a worktree) we must NOT fall through to the marker
    // walk, which would climb out of a nested `.pinagent/worktrees/<id>` into
    // the primary checkout's `pnpm-workspace.yaml`.
    const top = await gitToplevel(realCwd);
    const root = acceptRoot(top ?? findWorkspaceMarkerRoot(realCwd, home), realCwd, home);
    return root ? [root] : [];
  } catch {
    return [];
  }
}

async function gitToplevel(cwd: string): Promise<string | null> {
  try {
    const res = await runGitCapture(cwd, ['rev-parse', '--show-toplevel']);
    const out = res.code === 0 ? res.stdout.trim() : '';
    return out ? await realpath(out) : null;
  } catch {
    // git missing (spawn ENOENT) or the reported path vanished.
    return null;
  }
}

/**
 * Nearest strict ancestor of `cwd` that declares a JS workspace, stopping
 * before the home directory and the filesystem root.
 */
function findWorkspaceMarkerRoot(cwd: string, home: string): string | null {
  let dir = dirname(cwd);
  const fsRoot = parse(cwd).root;
  while (dir !== fsRoot && dir !== home && isStrictAncestor(dir, cwd)) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml')) || declaresWorkspaces(dir)) return dir;
    dir = dirname(dir);
  }
  return null;
}

function declaresWorkspaces(dir: string): boolean {
  const pkgPath = join(dir, 'package.json');
  if (!existsSync(pkgPath)) return false;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { workspaces?: unknown };
    return pkg.workspaces !== undefined && pkg.workspaces !== null;
  } catch {
    return false;
  }
}

/** A root is useful only if it strictly encloses `cwd` and isn't `/`, `~`, or above `~`. */
function acceptRoot(root: string | null, cwd: string, home: string): string | null {
  if (!root) return null;
  if (root === parse(root).root) return null;
  if (root === home || isStrictAncestor(root, home)) return null;
  return isStrictAncestor(root, cwd) ? root : null;
}

function isStrictAncestor(ancestor: string, child: string): boolean {
  const rel = relative(ancestor, child);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
