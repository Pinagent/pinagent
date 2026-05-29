// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { isNotionalCost } from '../src/event-bus';

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
});
