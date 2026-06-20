// SPDX-License-Identifier: Apache-2.0
/**
 * Near-bottom predicate for the RN transcript auto-follow
 * (src/native/scroll-follow.ts). The expanded StreamSheet only re-pins to the
 * bottom on a content change while the developer is already near the bottom, so
 * scrolling up to re-read earlier output during an active run isn't hijacked.
 * RN-runtime code isn't unit-testable here, so this pure math is the contract.
 */
import { describe, expect, it } from 'vitest';
import { isNearBottom, NEAR_BOTTOM_THRESHOLD } from '../src/native/scroll-follow';

describe('isNearBottom', () => {
  it('is true when scrolled exactly to the bottom', () => {
    // offset + viewport === content -> distance 0.
    expect(isNearBottom({ offsetY: 800, viewportH: 200, contentH: 1000 })).toBe(true);
  });

  it('is true when within the default threshold of the bottom', () => {
    // distance = 1000 - (790 + 200) = 10, <= 24.
    expect(isNearBottom({ offsetY: 790, viewportH: 200, contentH: 1000 })).toBe(true);
  });

  it('is false when scrolled up beyond the threshold', () => {
    // distance = 1000 - (500 + 200) = 300, > 24.
    expect(isNearBottom({ offsetY: 500, viewportH: 200, contentH: 1000 })).toBe(false);
  });

  it('is false just past the threshold boundary', () => {
    // distance = 1000 - (775 + 200) = 25, > 24.
    expect(isNearBottom({ offsetY: 775, viewportH: 200, contentH: 1000 })).toBe(false);
  });

  it('treats content shorter than the viewport as at-bottom', () => {
    expect(isNearBottom({ offsetY: 0, viewportH: 600, contentH: 100 })).toBe(true);
  });

  it('treats rubber-band over-scroll past the end as at-bottom', () => {
    // distance negative -> still <= threshold.
    expect(isNearBottom({ offsetY: 850, viewportH: 200, contentH: 1000 })).toBe(true);
  });

  it('honors an explicit larger threshold', () => {
    // distance = 1000 - (700 + 200) = 100; default would be false, 120 is true.
    expect(isNearBottom({ offsetY: 700, viewportH: 200, contentH: 1000, threshold: 120 })).toBe(
      true,
    );
  });

  it('honors an explicit smaller threshold', () => {
    // distance = 1000 - (795 + 200) = 5; default true, threshold 2 is false.
    expect(isNearBottom({ offsetY: 795, viewportH: 200, contentH: 1000, threshold: 2 })).toBe(
      false,
    );
  });

  it('falls back to the default threshold for a non-positive or non-finite value', () => {
    // distance = 10; <= default 24, > 0.
    const args = { offsetY: 790, viewportH: 200, contentH: 1000 };
    expect(isNearBottom({ ...args, threshold: 0 })).toBe(true);
    expect(isNearBottom({ ...args, threshold: -5 })).toBe(true);
    expect(isNearBottom({ ...args, threshold: Number.NaN })).toBe(true);
    // Sanity: the same distance is the default-threshold boundary case.
    expect(isNearBottom(args)).toBe(true);
  });

  it('exports a sane default threshold', () => {
    expect(NEAR_BOTTOM_THRESHOLD).toBeGreaterThan(0);
  });
});
