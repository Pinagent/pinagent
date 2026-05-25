import { existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Resolve the project root by:
 *   1. Honoring PINPOINT_PROJECT_ROOT if set.
 *   2. Walking up from cwd looking for `.pinpoint/`.
 *   3. Falling back to the nearest `package.json` ancestor.
 *   4. Falling back to cwd.
 */
export function resolveRoot(env: NodeJS.ProcessEnv, cwd: string): string {
  if (env.PINPOINT_PROJECT_ROOT) {
    return resolve(env.PINPOINT_PROJECT_ROOT);
  }

  const pinpointRoot = walkUp(cwd, (dir) => isDir(resolve(dir, '.pinpoint')));
  if (pinpointRoot) return pinpointRoot;

  const pkgRoot = walkUp(cwd, (dir) => existsSync(resolve(dir, 'package.json')));
  if (pkgRoot) return pkgRoot;

  return cwd;
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
