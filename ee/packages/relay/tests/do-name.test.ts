// SPDX-License-Identifier: Elastic-2.0
import { describe, expect, it } from 'vitest';
import { relayDoName } from '../src/do-name';

describe('relayDoName', () => {
  it('folds the tenant into the name so the same session in two tenants differs', () => {
    expect(relayDoName('orgA', 'sess1')).not.toBe(relayDoName('orgB', 'sess1'));
  });

  it('is stable for the same tenant + session (device and client co-locate)', () => {
    expect(relayDoName('orgA', 'sess1')).toBe(relayDoName('orgA', 'sess1'));
  });

  it('cannot alias across the tenant/session boundary', () => {
    // Under naive concatenation ('ab','c') and ('a','bc') both yield "abc".
    // The NUL separator (absent from any id) keeps the split unambiguous.
    expect(relayDoName('ab', 'c')).not.toBe(relayDoName('a', 'bc'));
  });
});
