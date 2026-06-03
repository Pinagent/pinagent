// SPDX-License-Identifier: Apache-2.0
/**
 * Small helpers for safe on-disk JSON stores (secrets, settings):
 *
 *  - `withFileLock` serializes a read-modify-write critical section against a
 *    path across all callers in this process, so two concurrent `patch()` calls
 *    can't both read the same base and clobber each other's update.
 *  - `atomicWriteFile` writes a sibling temp file (at the requested mode) then
 *    renames it over the target, so a reader never sees a half-written file and
 *    a sensitive file is never momentarily world-readable. A crash mid-write
 *    leaves the previous file intact instead of truncating it.
 */
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const locks = new Map<string, Promise<unknown>>();
let tmpCounter = 0;

/** Run `fn` holding an exclusive in-process lock keyed by `key` (a file path). */
export function withFileLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prior = locks.get(key) ?? Promise.resolve();
  // Chain after the prior holder whether it resolved or rejected.
  const run = prior.then(fn, fn);
  const tail = run.then(
    () => {},
    () => {},
  );
  locks.set(key, tail);
  // Drop the entry once we're the last in line, to bound the map.
  tail.then(() => {
    if (locks.get(key) === tail) locks.delete(key);
  });
  return run;
}

/**
 * Atomically write `data` to `path`: write a temp sibling (created with `mode`
 * when given, so it's never momentarily more permissive than intended) and
 * rename it over the target. Cleans up the temp on failure.
 */
export async function atomicWriteFile(path: string, data: string, mode?: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${tmpCounter++}`;
  try {
    await writeFile(tmp, data, mode !== undefined ? { mode } : undefined);
    await rename(tmp, path);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}
