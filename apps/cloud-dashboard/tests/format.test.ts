// SPDX-License-Identifier: Elastic-2.0
import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime } from '../src/format';

describe('formatDate', () => {
  it('formats an ISO timestamp as a friendly UTC date', () => {
    expect(formatDate('2026-05-01T00:00:00.000Z')).toBe('1 May 2026');
    expect(formatDate('2026-12-31T23:59:59Z')).toBe('31 Dec 2026');
  });

  it('renders in UTC regardless of the time-of-day', () => {
    // 23:30 UTC stays on the same UTC calendar day
    expect(formatDate('2026-01-15T23:30:00Z')).toBe('15 Jan 2026');
  });

  it('passes through an unparseable value unchanged', () => {
    expect(formatDate('not-a-date')).toBe('not-a-date');
    expect(formatDate('')).toBe('');
  });
});

describe('formatDateTime', () => {
  it('appends a zero-padded UTC time', () => {
    expect(formatDateTime('2026-05-30T12:00:00Z')).toBe('30 May 2026, 12:00 UTC');
    expect(formatDateTime('2026-05-30T09:05:00Z')).toBe('30 May 2026, 09:05 UTC');
  });

  it('passes through an unparseable value unchanged', () => {
    expect(formatDateTime('whenever')).toBe('whenever');
  });
});
