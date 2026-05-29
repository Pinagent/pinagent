// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { isNotionalCost, isUntrackedCost } from '../src/event-bus';

describe('isNotionalCost', () => {
  it('is true only for an oauth (claude login) credential source', () => {
    expect(isNotionalCost('oauth')).toBe(true);
  });

  it('is false for explicit API-key / provider sources', () => {
    expect(isNotionalCost('user')).toBe(false);
    expect(isNotionalCost('project')).toBe(false);
    expect(isNotionalCost('ANTHROPIC_API_KEY')).toBe(false);
  });

  it('is false for null / undefined (no recorded run, or older server)', () => {
    expect(isNotionalCost(null)).toBe(false);
    expect(isNotionalCost(undefined)).toBe(false);
  });

  // The two cost modes are mutually exclusive — a source is at most one of them.
  it('is false for the cli (untracked-cost) provider', () => {
    expect(isNotionalCost('cli')).toBe(false);
  });
});

describe('isUntrackedCost', () => {
  it('is true only for the bring-your-own-model cli provider', () => {
    expect(isUntrackedCost('cli')).toBe(true);
  });

  it('is false for billed and subscription sources', () => {
    expect(isUntrackedCost('user')).toBe(false);
    expect(isUntrackedCost('oauth')).toBe(false);
  });

  it('is false for null / undefined', () => {
    expect(isUntrackedCost(null)).toBe(false);
    expect(isUntrackedCost(undefined)).toBe(false);
  });
});
