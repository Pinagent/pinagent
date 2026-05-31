// SPDX-License-Identifier: Apache-2.0
/**
 * File source for the browser composer's `@`-mention picker. Two modes,
 * mirroring how Claude Code's own `@` behaves:
 *
 *  - **project** (default) — fuzzy-match over the project's files. Uses
 *    `git ls-files` (tracked + untracked-but-not-ignored) so the list
 *    respects `.gitignore` and skips `node_modules`/build noise. Falls
 *    back to a bounded filesystem walk when the project isn't a git repo.
 *  - **path** — when the query starts with `/` or `~`, browse the real
 *    filesystem directory at that prefix. This is the "reach anywhere on
 *    the machine" mode (e.g. an absolute path into `~/Pictures`). It's
 *    safe here because the whole tool is localhost-only and the trust
 *    boundary is the developer's own machine (see Invariants in CLAUDE.md).
 *
 * Both modes return the same {@link FileEntry} shape and cap their output
 * so a huge tree can't blow up the response.
 */
import { type Dirent, existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { runGitCapture } from './git-utils';

/** One pickable row in the `@`-mention dropdown. */
export interface FileEntry {
  /**
   * The string inserted into the prompt when picked. Project files use a
   * repo-relative path (`src/Foo.tsx`); path-mode entries use the absolute
   * path so the reference is unambiguous outside the repo.
   */
  path: string;
  /** Basename, shown as the primary label. */
  name: string;
  /** Directory shown alongside the name (repo-relative or absolute dir). */
  dir: string;
  /** True for directories — the client keeps the menu open to drill in. */
  isDir: boolean;
}

export interface ListFilesResult {
  /** Which branch ran — lets the client tweak its UX (e.g. show full paths). */
  mode: 'project' | 'path';
  entries: FileEntry[];
  /** True when results were capped (more matches exist than were returned). */
  truncated: boolean;
}

const MAX_ENTRIES = 50;
/** Directories never worth walking in the fs-walk fallback. */
const WALK_SKIP = new Set([
  'node_modules',
  '.git',
  '.next',
  '.turbo',
  'dist',
  'build',
  'coverage',
  '.pinagent',
]);
const WALK_FILE_CAP = 20_000;

/**
 * Resolve a `@`-mention query into a ranked list of files/dirs. `query`
 * is the text the user typed after `@` (may be empty for the initial
 * "show me everything" menu).
 */
export async function listProjectFiles(root: string, query: string): Promise<ListFilesResult> {
  const q = query ?? '';
  // A leading `/` or `~` means the user is typing an explicit filesystem
  // path — browse it directly rather than fuzzy-matching project files.
  if (q.startsWith('/') || q.startsWith('~')) {
    return browsePath(q);
  }
  return browseProject(root, q);
}

// ---------------------------------------------------------------------------
// project mode
// ---------------------------------------------------------------------------

async function browseProject(root: string, query: string): Promise<ListFilesResult> {
  const all = (await gitFiles(root)) ?? (await walkFiles(root));
  const ranked = rankFuzzy(all, query);
  const truncated = ranked.length > MAX_ENTRIES;
  const entries = ranked.slice(0, MAX_ENTRIES).map((path) => toEntry(path, false));
  return { mode: 'project', entries, truncated };
}

/**
 * Project file list via git: tracked files plus untracked-but-not-ignored
 * ones (so a freshly-created file shows up). Returns null when this isn't
 * a git repo or git isn't available, so the caller can fall back.
 */
async function gitFiles(root: string): Promise<string[] | null> {
  try {
    const res = await runGitCapture(root, [
      'ls-files',
      '--cached',
      '--others',
      '--exclude-standard',
      '--deduplicate',
    ]);
    if (res.code !== 0) return null;
    return res.stdout.split('\n').filter((l) => l.length > 0);
  } catch {
    // git binary missing — fall back to the fs walk.
    return null;
  }
}

/** Bounded recursive walk used when the project isn't a git repo. */
async function walkFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0 && out.length < WALK_FILE_CAP) {
    const dir = stack.pop();
    if (!dir) break;
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (ent.name.startsWith('.git')) continue;
      if (ent.isDirectory()) {
        if (WALK_SKIP.has(ent.name)) continue;
        stack.push(join(dir, ent.name));
      } else if (ent.isFile()) {
        // Store repo-relative, forward-slashed (matches git ls-files).
        const rel = relPosix(root, join(dir, ent.name));
        out.push(rel);
        if (out.length >= WALK_FILE_CAP) break;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// path mode
// ---------------------------------------------------------------------------

async function browsePath(query: string): Promise<ListFilesResult> {
  const expanded = query.startsWith('~') ? join(homedir(), query.slice(1)) : query;
  // Split into the directory to list and the partial basename to filter by.
  // A trailing slash means "list this dir, no filter".
  const endsWithSep = expanded.endsWith('/') || expanded.endsWith(sep);
  const dir = endsWithSep ? expanded : dirname(expanded);
  const partial = endsWithSep ? '' : basename(expanded);
  if (!isAbsolute(dir) || !existsSync(dir)) {
    return { mode: 'path', entries: [], truncated: false };
  }

  let dirents: Dirent[];
  try {
    dirents = await readdir(dir, { withFileTypes: true });
  } catch {
    return { mode: 'path', entries: [], truncated: false };
  }

  const lower = partial.toLowerCase();
  const matched = dirents
    .filter((d) => (lower ? d.name.toLowerCase().startsWith(lower) : !d.name.startsWith('.')))
    .filter((d) => d.isDirectory() || d.isFile());
  // Directories first, then alphabetical — mirrors a shell completion.
  matched.sort((a, b) => {
    const ad = a.isDirectory() ? 0 : 1;
    const bd = b.isDirectory() ? 0 : 1;
    if (ad !== bd) return ad - bd;
    return a.name.localeCompare(b.name);
  });

  const truncated = matched.length > MAX_ENTRIES;
  const entries: FileEntry[] = matched.slice(0, MAX_ENTRIES).map((d) => {
    const abs = join(dir, d.name);
    return { path: abs, name: d.name, dir, isDir: d.isDirectory() };
  });
  return { mode: 'path', entries, truncated };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function toEntry(path: string, isDir: boolean): FileEntry {
  return { path, name: basename(path), dir: dirname(path), isDir };
}

function relPosix(root: string, target: string): string {
  const rel = resolve(target).slice(resolve(root).length + 1);
  return sep === '/' ? rel : rel.split(sep).join('/');
}

/**
 * Subsequence fuzzy match + score, newest-friendly ordering. Empty query
 * returns the list as-is (capped by the caller). Scoring favours: matches
 * in the basename, contiguous runs, and matches right after a path
 * separator — the things that make a path "feel" like the right one.
 */
function rankFuzzy(paths: string[], query: string): string[] {
  if (!query) return paths;
  const q = query.toLowerCase();
  const scored: Array<{ path: string; score: number }> = [];
  for (const path of paths) {
    const score = fuzzyScore(path.toLowerCase(), q, path);
    if (score > 0) scored.push({ path, score });
  }
  scored.sort((a, b) => b.score - a.score || a.path.length - b.path.length);
  return scored.map((s) => s.path);
}

function fuzzyScore(haystack: string, needle: string, original: string): number {
  let hi = 0;
  let score = 0;
  let prevMatch = -2;
  const baseStart = original.length - basename(original).length;
  for (let ni = 0; ni < needle.length; ni++) {
    const ch = needle[ni] ?? '';
    const found = haystack.indexOf(ch, hi);
    if (found === -1) return 0;
    score += 1;
    if (found === prevMatch + 1) score += 2; // contiguous run
    if (found === 0 || haystack[found - 1] === '/') score += 3; // segment start
    if (found >= baseStart) score += 2; // inside the basename
    prevMatch = found;
    hi = found + 1;
  }
  return score;
}
