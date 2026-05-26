// SPDX-License-Identifier: Apache-2.0
/**
 * Per-project FIFO queue for landing/discarding pinagent worktrees.
 *
 * v2 plan §6 calls for serialised merges so two widgets racing to land
 * onto the same target branch can't interleave. We do that by chaining
 * each enqueued job onto the project's current tail Promise. Failures
 * are isolated — a rejected job's error is returned to its caller, but
 * the queue continues from the same logical point so the next job
 * isn't poisoned.
 *
 * In-memory only. On an agent-runner restart, in-flight queue entries are
 * dropped along with the WS connections that initiated them; the DB
 * still shows `worktreeState='active'` for any conversation that
 * hadn't reached `landed`/`discarded`, so the user can re-click Land
 * from the widget after the server comes back.
 */

const QUEUES_SYMBOL = Symbol.for('pinagent.merge-queue.tails');

// Module-eval-survival pattern, same as event-bus.ts and agent.ts:
// Next 16 / Turbopack can re-evaluate the module graph, and a fresh
// Map per evaluation would break serialisation guarantees the moment
// a tail Promise is held by one instance while the next enqueue lands
// in another. A globalThis Symbol pins the Map across evals.
const tails: Map<string, Promise<void>> = ((globalThis as Record<symbol, unknown>)[QUEUES_SYMBOL] as
  | Map<string, Promise<void>>
  | undefined) ?? new Map<string, Promise<void>>();
(globalThis as Record<symbol, unknown>)[QUEUES_SYMBOL] = tails;

/**
 * Enqueue `fn` onto the FIFO for `projectRoot`. The returned Promise
 * resolves/rejects with whatever `fn` does once every previously
 * enqueued job for this project has settled. A throwing `fn` does not
 * poison the queue: subsequent enqueues still run.
 */
export function enqueue<T>(projectRoot: string, fn: () => Promise<T>): Promise<T> {
  const previous = tails.get(projectRoot) ?? Promise.resolve();
  // `.catch(() => {})` on the linkage Promise — but NOT on the user-
  // visible one — keeps the chain alive after a failure while still
  // surfacing the error to the original caller via `result`.
  const result = previous.then(fn, fn);
  const next = result.then(
    () => undefined,
    () => undefined,
  );
  tails.set(projectRoot, next);
  // GC: when this job's `next` is the current tail, drop the entry once
  // it settles. Avoids unbounded growth of the Map for long-lived
  // dev sessions.
  void next.then(() => {
    if (tails.get(projectRoot) === next) {
      tails.delete(projectRoot);
    }
  });
  return result;
}

/** Test-only: number of projects with an outstanding queue. */
export function queueSize(): number {
  return tails.size;
}

/** Test-only: drop all queue state. Lets tests run isolated. */
export function _resetForTests(): void {
  tails.clear();
}
