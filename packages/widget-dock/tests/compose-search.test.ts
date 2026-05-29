// SPDX-License-Identifier: Apache-2.0
/**
 * Pin the `?ids=...` search-param contract for the `/prs/new` route.
 * The Changes view builds this when handing a multi-selection to the
 * composer; the route reads it back to pre-check the picker. The
 * validator decides what the dock accepts from a pasted link or
 * back/forward navigation; `parseComposeIds` turns it into the id list.
 */
import { describe, expect, it } from 'vitest';
import { parseComposeIds, validateComposeSearch } from '../src/routes/compose-search';

describe('validateComposeSearch', () => {
  it('returns an empty object for no params', () => {
    expect(validateComposeSearch({})).toEqual({});
  });

  it('passes through a valid ids string', () => {
    expect(validateComposeSearch({ ids: 'a,b,c' })).toEqual({ ids: 'a,b,c' });
  });

  it('drops unknown params silently', () => {
    expect(validateComposeSearch({ ids: 'a', foo: 'bar', n: 42 })).toEqual({ ids: 'a' });
  });

  it('collapses an empty ids to absent', () => {
    expect(validateComposeSearch({ ids: '' })).toEqual({});
  });

  it('collapses a non-string ids to absent', () => {
    expect(validateComposeSearch({ ids: 42 })).toEqual({});
    expect(validateComposeSearch({ ids: null })).toEqual({});
    expect(validateComposeSearch({ ids: ['a'] })).toEqual({});
  });
});

describe('parseComposeIds', () => {
  it('returns an empty array when ids is absent', () => {
    expect(parseComposeIds({})).toEqual([]);
  });

  it('splits a comma-separated list, preserving order', () => {
    expect(parseComposeIds({ ids: 'a,b,c' })).toEqual(['a', 'b', 'c']);
  });

  it('trims whitespace around segments', () => {
    expect(parseComposeIds({ ids: ' a , b ,c ' })).toEqual(['a', 'b', 'c']);
  });

  it('drops blank segments from stray commas', () => {
    expect(parseComposeIds({ ids: 'a,,b,' })).toEqual(['a', 'b']);
    expect(parseComposeIds({ ids: ',' })).toEqual([]);
  });

  it('handles a single id', () => {
    expect(parseComposeIds({ ids: 'cv_03' })).toEqual(['cv_03']);
  });
});
