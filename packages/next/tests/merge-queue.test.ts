import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { _resetForTests, enqueue, queueSize } from '../src/merge-queue';

/**
 * Pure-logic tests for the per-project FIFO. No git, no SQLite — the queue
 * just chains promises in submission order and isolates failures.
 */
describe('merge-queue', () => {
  beforeEach(() => {
    _resetForTests();
  });
  afterEach(() => {
    _resetForTests();
  });

  it('runs jobs in FIFO submission order per project', async () => {
    const trace: string[] = [];
    const make = (label: string, delay: number) => () =>
      new Promise<string>((res) => {
        setTimeout(() => {
          trace.push(label);
          res(label);
        }, delay);
      });

    // First job is slow; second is fast. Without serialisation, second
    // would finish first. With the queue, A must come before B.
    const a = enqueue('/p', make('A', 30));
    const b = enqueue('/p', make('B', 1));

    await Promise.all([a, b]);
    expect(trace).toEqual(['A', 'B']);
  });

  it('isolates failures — a rejected job does not poison the queue', async () => {
    const a = enqueue<string>('/p', async () => {
      throw new Error('boom');
    });
    const b = enqueue<string>('/p', async () => 'ok');

    await expect(a).rejects.toThrow('boom');
    await expect(b).resolves.toBe('ok');
  });

  it('queues are per project — different roots run concurrently', async () => {
    const trace: string[] = [];
    const make = (label: string, delay: number) => () =>
      new Promise<void>((res) => {
        setTimeout(() => {
          trace.push(label);
          res();
        }, delay);
      });

    // P1's slow job and P2's fast job must overlap (not be serialised
    // against each other). If they shared a queue, P1 would finish first.
    const p1 = enqueue('/project-1', make('P1', 20));
    const p2 = enqueue('/project-2', make('P2', 1));

    await Promise.all([p1, p2]);
    expect(trace).toEqual(['P2', 'P1']);
  });

  it('drops queue entries after they settle', async () => {
    const job = enqueue('/p', async () => 'done');
    expect(queueSize()).toBe(1);
    await job;
    // The GC hook runs in a microtask after `next` settles; wait for it.
    await new Promise((r) => setTimeout(r, 0));
    expect(queueSize()).toBe(0);
  });

  it('preserves serialisation when middle job throws', async () => {
    const trace: string[] = [];
    const make = (label: string) => () =>
      new Promise<string>((res) => {
        trace.push(label);
        res(label);
      });

    const a = enqueue('/p', make('A'));
    const bad = enqueue<string>('/p', async () => {
      trace.push('B(throw)');
      throw new Error('B');
    });
    const c = enqueue('/p', make('C'));

    await a;
    await expect(bad).rejects.toThrow('B');
    await c;
    expect(trace).toEqual(['A', 'B(throw)', 'C']);
  });
});
