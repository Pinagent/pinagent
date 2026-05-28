// SPDX-License-Identifier: Apache-2.0
/**
 * `relativeTime` formatter for list-row timestamps.
 *
 * Pins each bucket so a regression in the boundary math (the
 * "everything reads 'just now'" bug we shipped when `TimestampDot`
 * was passing a hardcoded fixture anchor instead of `Date.now()`)
 * surfaces here instead of in the UI.
 */
import { describe, expect, it } from 'vitest';
import { relativeTime } from '../src/lib/time';

// Anchor "now" so the assertions are deterministic regardless of when
// the test runs. Chosen mid-month so the ±days/weeks math doesn't
// straddle a month boundary.
const NOW = Date.parse('2026-05-15T12:00:00Z');
const offset = (ms: number) => new Date(NOW - ms).toISOString();

const SEC = 1_000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('relativeTime', () => {
  it('returns — for an unparseable iso string', () => {
    expect(relativeTime('not-a-date', NOW)).toBe('—');
  });

  it('returns "just now" for the same instant', () => {
    expect(relativeTime(new Date(NOW).toISOString(), NOW)).toBe('just now');
  });

  it('returns "just now" up to (but not including) 1 minute ago', () => {
    expect(relativeTime(offset(30 * SEC), NOW)).toBe('just now');
    expect(relativeTime(offset(MIN - 1), NOW)).toBe('just now');
  });

  it('returns minutes between 1 minute and 1 hour', () => {
    expect(relativeTime(offset(MIN), NOW)).toBe('1m ago');
    expect(relativeTime(offset(5 * MIN), NOW)).toBe('5m ago');
    expect(relativeTime(offset(HOUR - 1), NOW)).toBe('59m ago');
  });

  it('returns hours between 1 hour and 1 day', () => {
    expect(relativeTime(offset(HOUR), NOW)).toBe('1h ago');
    expect(relativeTime(offset(3 * HOUR), NOW)).toBe('3h ago');
    expect(relativeTime(offset(DAY - 1), NOW)).toBe('23h ago');
  });

  it('returns days between 1 and 7', () => {
    expect(relativeTime(offset(DAY), NOW)).toBe('1d ago');
    expect(relativeTime(offset(3 * DAY), NOW)).toBe('3d ago');
    expect(relativeTime(offset(7 * DAY - 1), NOW)).toBe('6d ago');
  });

  it('returns weeks between 1 and ~4', () => {
    expect(relativeTime(offset(7 * DAY), NOW)).toBe('1w ago');
    expect(relativeTime(offset(14 * DAY), NOW)).toBe('2w ago');
  });

  it('falls back to an absolute month/day past ~30 days', () => {
    // Jan 1, 2026 viewed from May 15 — well past the 30-day cutoff.
    const out = relativeTime('2026-01-01T12:00:00Z', NOW);
    // Locale formatting varies (e.g. "Jan 1" vs "1 Jan"), so we just
    // assert it doesn't fall into a relative bucket.
    expect(out).not.toMatch(/ago$/);
    expect(out).not.toBe('just now');
    expect(out).not.toBe('—');
  });

  it('regression: a real timestamp from earlier today reads as hours/minutes, not "just now"', () => {
    // The bug: `TimestampDot` was passing a hardcoded May-26 anchor to
    // `relativeTime`, so every real timestamp (always after May-26 in
    // production) hit `diff < MIN` and rendered "just now". This
    // assertion would have failed under that anchor: `2h` of distance
    // must render as "2h ago", not "just now".
    expect(relativeTime(offset(2 * HOUR), NOW)).toBe('2h ago');
  });
});
