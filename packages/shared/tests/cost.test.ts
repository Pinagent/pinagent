// SPDX-License-Identifier: Apache-2.0
/**
 * Pin the compact-USD formatting shared by the widget tray and the
 * dock's cost chip. Both surfaces render running cost; this is the one
 * place the dollar formatting lives, so the boundaries (the $0.01
 * sub-cent cutoff and rounding) are worth nailing down.
 */
import { describe, expect, it } from 'vitest';
import { formatCompactUsd } from '../src/cost';

describe('formatCompactUsd', () => {
  it('uses 4-decimal precision below $0.01 so cheap turns still surface', () => {
    expect(formatCompactUsd(0.0023)).toBe('$0.0023');
    expect(formatCompactUsd(0.0001)).toBe('$0.0001');
    expect(formatCompactUsd(0)).toBe('$0.0000');
  });

  it('trims to 2 decimals at or above $0.01', () => {
    expect(formatCompactUsd(0.01)).toBe('$0.01');
    expect(formatCompactUsd(0.12)).toBe('$0.12');
    expect(formatCompactUsd(3.21)).toBe('$3.21');
  });

  it('rounds to 2 decimals above the cutoff', () => {
    // 0.125 → "$0.13" (toFixed half-to-even/up); 0.124 → "$0.12".
    expect(formatCompactUsd(0.126)).toBe('$0.13');
    expect(formatCompactUsd(0.124)).toBe('$0.12');
  });

  it('rounds within the sub-cent band at 4 decimals', () => {
    expect(formatCompactUsd(0.00008)).toBe('$0.0001');
  });

  it('handles the boundary just under a cent', () => {
    // 0.009999 is < 0.01 → 4-decimal path, rounds to $0.0100.
    expect(formatCompactUsd(0.009999)).toBe('$0.0100');
  });
});
