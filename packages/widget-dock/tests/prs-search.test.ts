// SPDX-License-Identifier: Apache-2.0
/**
 * Pin the `?number=...` search-param validator for the `/prs` route.
 * The activity feed builds the URL on a `pr_created` row click and the
 * PRs tab reads it back to scroll + highlight the matching row; the
 * validator decides what the tab accepts from in-app nav, a pasted link,
 * or back/forward.
 */
import { describe, expect, it } from 'vitest';
import { validatePrsSearch } from '../src/routes/prs-search';

describe('validatePrsSearch', () => {
  it('returns an empty object for no params', () => {
    expect(validatePrsSearch({})).toEqual({});
  });

  it('passes through a positive integer (in-app Link navigation)', () => {
    expect(validatePrsSearch({ number: 42 })).toEqual({ number: 42 });
  });

  it('coerces a numeric string (pasted URL / back-forward)', () => {
    expect(validatePrsSearch({ number: '42' })).toEqual({ number: 42 });
  });

  it('drops unknown params silently', () => {
    expect(validatePrsSearch({ number: 7, foo: 'bar' })).toEqual({ number: 7 });
  });

  it('collapses zero, negatives, and non-integers to absent', () => {
    expect(validatePrsSearch({ number: 0 })).toEqual({});
    expect(validatePrsSearch({ number: -3 })).toEqual({});
    expect(validatePrsSearch({ number: 4.5 })).toEqual({});
    expect(validatePrsSearch({ number: '12.5' })).toEqual({});
  });

  it('collapses non-numeric / malformed input to absent', () => {
    expect(validatePrsSearch({ number: 'abc' })).toEqual({});
    expect(validatePrsSearch({ number: '' })).toEqual({});
    expect(validatePrsSearch({ number: null })).toEqual({});
    expect(validatePrsSearch({ number: [42] })).toEqual({});
  });
});
