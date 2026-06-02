// SPDX-License-Identifier: Apache-2.0
/**
 * Filesystem watcher over the host project root. Fires `onChange` (debounced)
 * whenever a source file is added/changed/removed — so the dock's dashboard
 * can refetch the working-copy git status when the developer edits or reverts
 * files directly in their editor, instead of going stale until the next
 * pinagent lifecycle event or window-focus refetch.
 *
 * Wired to a `working_copy_changed` project-event fan-out in ws-server.ts.
 *
 * Deliberately ignores `.git` (git's own churn), `.pinagent` (our SQLite +
 * screenshots + per-conversation worktrees — watching them would self-
 * trigger), dependency/build dirs, and logs. The match is a path predicate
 * (not a glob) so it behaves identically on chokidar v3 and v4.
 */
import { sep } from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';

/** Directory names whose entire subtree is irrelevant to the working copy. */
const IGNORED_DIRS = new Set([
  '.git',
  '.pinagent',
  'node_modules',
  'dist',
  'build',
  '.next',
  '.turbo',
  '.cache',
  '.vercel',
  'coverage',
  '.output',
  '.svelte-kit',
]);

/** True when any path segment is an ignored directory (or it's a log file). */
function isIgnored(path: string): boolean {
  if (path.endsWith('.log')) return true;
  for (const segment of path.split(sep)) {
    if (IGNORED_DIRS.has(segment)) return true;
  }
  return false;
}

export interface WorkingCopyWatcher {
  close(): Promise<void>;
}

export interface WorkingCopyWatcherOptions {
  /** Coalesce a burst of fs events (e.g. a multi-file `git checkout`) into one
   *  `onChange`. Default 300ms. */
  debounceMs?: number;
}

/**
 * Start watching `projectRoot`. Returns a handle whose `close()` tears the
 * watcher down. `onChange` never fires for the initial scan (ignoreInitial),
 * only for subsequent edits, and is debounced.
 */
export function createWorkingCopyWatcher(
  projectRoot: string,
  onChange: () => void,
  options: WorkingCopyWatcherOptions = {},
): WorkingCopyWatcher {
  const debounceMs = options.debounceMs ?? 300;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const fire = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      onChange();
    }, debounceMs);
  };

  const watcher: FSWatcher = chokidar.watch(projectRoot, {
    ignored: (path: string) => isIgnored(path),
    ignoreInitial: true,
    // Don't hold the event loop open on our account — the dev server keeps
    // the process alive, and we want a clean exit if it doesn't.
    persistent: false,
  });

  watcher.on('add', fire);
  watcher.on('change', fire);
  watcher.on('unlink', fire);
  watcher.on('addDir', fire);
  watcher.on('unlinkDir', fire);
  // A watch error (e.g. EMFILE on a huge tree) must never crash the dev
  // server — the dashboard just falls back to focus/lifecycle refetches.
  watcher.on('error', (err: unknown) => {
    // eslint-disable-next-line no-console
    console.error('[pinagent] working-copy watcher error:', err);
  });

  return {
    async close() {
      if (timer) clearTimeout(timer);
      timer = null;
      await watcher.close();
    },
  };
}
