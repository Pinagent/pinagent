// SPDX-License-Identifier: Apache-2.0
/**
 * Pin the format + tone thresholds on the running-cost chip. The chip
 * is what tells users "you're $X away from your cap before the agent
 * starts refusing turns" — getting the thresholds wrong undermines
 * the whole point of the cap enforcement that ships alongside.
 *
 * Pure formatter only — the React rendering layer is a thin
 * tone-to-className map covered indirectly.
 */
import { describe, expect, it } from 'vitest';
import { formatCostBadge } from '../src/lib/cost';

describe('formatCostBadge — label', () => {
  it('shows only the running cost when no cap is provided', () => {
    expect(formatCostBadge(0.12).label).toBe('$0.12');
    expect(formatCostBadge(0.12, undefined).label).toBe('$0.12');
    expect(formatCostBadge(0.12, null).label).toBe('$0.12');
    expect(formatCostBadge(0.12, 0).label).toBe('$0.12');
  });

  it('shows running cost / cap when a positive cap is provided', () => {
    expect(formatCostBadge(0.12, 5).label).toBe('$0.12 / $5.00');
    expect(formatCostBadge(3.21, 5).label).toBe('$3.21 / $5.00');
  });

  it('uses 4-decimal precision for sub-cent amounts so cheap turns still surface', () => {
    expect(formatCostBadge(0.0023).label).toBe('$0.0023');
    expect(formatCostBadge(0.0023, 5).label).toBe('$0.0023 / $5.00');
  });

  it('rejects non-finite caps (NaN / Infinity) — falls back to no-cap label', () => {
    expect(formatCostBadge(0.5, NaN).label).toBe('$0.50');
    expect(formatCostBadge(0.5, Infinity).label).toBe('$0.50');
  });
});

describe('formatCostBadge — tone', () => {
  it("is 'normal' when no cap is provided", () => {
    expect(formatCostBadge(99, undefined).tone).toBe('normal');
    expect(formatCostBadge(99, null).tone).toBe('normal');
    expect(formatCostBadge(99, 0).tone).toBe('normal');
  });

  it("is 'normal' below the 80% warn threshold", () => {
    expect(formatCostBadge(0, 5).tone).toBe('normal');
    expect(formatCostBadge(1, 5).tone).toBe('normal');
    expect(formatCostBadge(3.99, 5).tone).toBe('normal'); // 79.8%
  });

  it("flips to 'warn' at 80% of cap", () => {
    expect(formatCostBadge(4, 5).tone).toBe('warn'); // exactly 80%
    expect(formatCostBadge(4.5, 5).tone).toBe('warn');
    expect(formatCostBadge(4.99, 5).tone).toBe('warn');
  });

  it("flips to 'over' at 100% of cap", () => {
    expect(formatCostBadge(5, 5).tone).toBe('over'); // exactly 100%
    expect(formatCostBadge(5.01, 5).tone).toBe('over');
    expect(formatCostBadge(10, 5).tone).toBe('over');
  });

  it('handles very low caps without dividing by zero', () => {
    // perConversationCapUsd's schema enforces min 0.1; the helper
    // shouldn't crash on the smallest allowed cap. 80% of $0.10 = $0.08.
    expect(formatCostBadge(0.05, 0.1).tone).toBe('normal'); // 50%
    expect(formatCostBadge(0.08, 0.1).tone).toBe('warn'); // exactly 80%
    expect(formatCostBadge(0.2, 0.1).tone).toBe('over'); // 200%
  });
});
