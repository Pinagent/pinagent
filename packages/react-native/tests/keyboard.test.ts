// SPDX-License-Identifier: Apache-2.0
/**
 * Unit tests for the RN widget's keyboard-shortcut decision. RN has no global
 * key stream, so the shortcuts ride on TextInput key events; the only pure
 * decision is "does this key back out of the sheet?" (Escape). Enter-to-submit
 * is wired straight to `onSubmitEditing` and needs no predicate. The wiring
 * itself lives in the RN components, which aren't unit-testable here.
 */
import { describe, expect, it } from 'vitest';
import { isDismissKey } from '../src/native/keyboard';

describe('isDismissKey', () => {
  it('is true for Escape', () => {
    expect(isDismissKey('Escape')).toBe(true);
  });

  it('is false for Enter, so submit stays separate from dismiss', () => {
    expect(isDismissKey('Enter')).toBe(false);
  });

  it('is false for printable keys, so normal typing never dismisses', () => {
    for (const key of ['a', 'c', 'N', ' ', 'Backspace', 'ArrowUp', 'esc', 'Escape ']) {
      expect(isDismissKey(key)).toBe(false);
    }
  });
});
