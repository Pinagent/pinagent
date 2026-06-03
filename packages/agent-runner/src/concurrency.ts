// SPDX-License-Identifier: Apache-2.0
/**
 * Bounded-concurrency `map`. A dock refresh fans out per-worktree git work
 * (status, merge-base, rev-list, diff, du …) — several child processes per row.
 * With an unbounded `Promise.all` over many retained worktrees that's hundreds
 * of concurrent processes in one tick, enough to exhaust file descriptors / PIDs
 * and stall the dev box. `mapLimit` keeps at most `limit` running at once while
 * preserving input order in the result.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  const worker = async (): Promise<void> => {
    for (let i = next++; i < items.length; i = next++) {
      results[i] = await fn(items[i] as T, i);
    }
  };
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}
