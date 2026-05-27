// SPDX-License-Identifier: Apache-2.0
/**
 * Pin the `?id=...` search-param validator for the `/conversations`
 * route. The dock builds the URL on row click and reads it back on
 * mount; the validator decides what the dock will accept from a
 * pasted-link or back/forward navigation.
 */
import { describe, expect, it } from 'vitest';
import { validateConversationsSearch } from '../src/routes/conversations-search';

describe('validateConversationsSearch', () => {
  it('returns an empty object for no params', () => {
    expect(validateConversationsSearch({})).toEqual({});
  });

  it('passes through a valid id', () => {
    expect(validateConversationsSearch({ id: 'cv_03' })).toEqual({ id: 'cv_03' });
  });

  it('drops unknown params silently', () => {
    expect(validateConversationsSearch({ id: 'cv_03', foo: 'bar', n: 42 })).toEqual({
      id: 'cv_03',
    });
  });

  it('collapses an empty id to absent', () => {
    expect(validateConversationsSearch({ id: '' })).toEqual({});
  });

  it('collapses a non-string id to absent', () => {
    expect(validateConversationsSearch({ id: 42 })).toEqual({});
    expect(validateConversationsSearch({ id: null })).toEqual({});
    expect(validateConversationsSearch({ id: ['cv_03'] })).toEqual({});
  });

  it('does not crash on undefined-shaped input', () => {
    // TanStack Router can hand `validateSearch` an empty object; never
    // null/undefined, but defensive in case the contract changes.
    expect(validateConversationsSearch({})).toEqual({});
  });
});
