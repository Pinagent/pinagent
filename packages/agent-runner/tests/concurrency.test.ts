// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { mapLimit } from '../src/concurrency';

describe('mapLimit', () => {
  it('preserves input order in the result', async () => {
    const out = await mapLimit([1, 2, 3, 4, 5], 2, async (n) => n * 10);
    expect(out).toEqual([10, 20, 30, 40, 50]);
  });

  it('never runs more than `limit` at once', async () => {
    let active = 0;
    let maxActive = 0;
    await mapLimit(
      Array.from({ length: 20 }, (_, i) => i),
      4,
      async (i) => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 1));
        active--;
        return i;
      },
    );
    expect(maxActive).toBeLessThanOrEqual(4);
    expect(maxActive).toBeGreaterThan(1); // it did run in parallel
  });

  it('handles an empty input and a limit larger than the input', async () => {
    expect(await mapLimit([], 8, async (x) => x)).toEqual([]);
    expect(await mapLimit([1], 8, async (n) => n + 1)).toEqual([2]);
  });
});
