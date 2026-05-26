// SPDX-License-Identifier: Apache-2.0
// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { isHopKey, pickNextActive } from '../src/widget';

describe('isHopKey', () => {
  it('matches Shift+N exactly', () => {
    const e = new KeyboardEvent('keydown', { key: 'N', shiftKey: true });
    expect(isHopKey(e)).toBe(true);
  });

  it('does not match lowercase n without shift', () => {
    const e = new KeyboardEvent('keydown', { key: 'n' });
    expect(isHopKey(e)).toBe(false);
  });

  it('does not match uppercase N without shift', () => {
    // Some platforms report key='N' when caps-lock is on without
    // shiftKey set; we still require shiftKey true to avoid
    // accidentally firing in that case.
    const e = new KeyboardEvent('keydown', { key: 'N' });
    expect(isHopKey(e)).toBe(false);
  });

  it('rejects Cmd+Shift+N (the browser/OS owns these chords)', () => {
    const e = new KeyboardEvent('keydown', { key: 'N', shiftKey: true, metaKey: true });
    expect(isHopKey(e)).toBe(false);
  });

  it('rejects Ctrl+Shift+N', () => {
    const e = new KeyboardEvent('keydown', { key: 'N', shiftKey: true, ctrlKey: true });
    expect(isHopKey(e)).toBe(false);
  });

  it('rejects Alt+Shift+N', () => {
    const e = new KeyboardEvent('keydown', { key: 'N', shiftKey: true, altKey: true });
    expect(isHopKey(e)).toBe(false);
  });

  it('rejects other Shift-letter combos', () => {
    expect(isHopKey(new KeyboardEvent('keydown', { key: 'M', shiftKey: true }))).toBe(false);
    expect(isHopKey(new KeyboardEvent('keydown', { key: 'A', shiftKey: true }))).toBe(false);
  });
});

describe('pickNextActive', () => {
  // We use plain strings as stand-ins for Composer instances —
  // pickNextActive is generic and identity-based, so the shape of T
  // doesn't matter.

  it('returns null on an empty list', () => {
    expect(pickNextActive([], null)).toBeNull();
    expect(pickNextActive([], 'whatever')).toBeNull();
  });

  it('returns null when the only active item is already current', () => {
    expect(pickNextActive(['a'], 'a')).toBeNull();
  });

  it('returns the only item when current is something else', () => {
    expect(pickNextActive(['a'], null)).toBe('a');
    expect(pickNextActive(['a'], 'unrelated')).toBe('a');
  });

  it('rotates insertion-order forward', () => {
    expect(pickNextActive(['a', 'b', 'c'], 'a')).toBe('b');
    expect(pickNextActive(['a', 'b', 'c'], 'b')).toBe('c');
  });

  it('wraps around at the end', () => {
    expect(pickNextActive(['a', 'b', 'c'], 'c')).toBe('a');
  });

  it('starts at active[0] when current is null', () => {
    expect(pickNextActive(['a', 'b', 'c'], null)).toBe('a');
  });

  it('starts at active[0] when current is not in the list', () => {
    // Useful when the user collapsed the current via Esc — the next
    // hop should land on something in the active set, not stay null.
    expect(pickNextActive(['a', 'b', 'c'], 'd-not-here')).toBe('a');
  });

  it('is identity-based (does not compare by structural equality)', () => {
    const a = { tag: 'a' };
    const b = { tag: 'b' };
    const aClone = { tag: 'a' };
    expect(pickNextActive([a, b], a)).toBe(b);
    // A different object that "looks like" a is treated as unknown
    // → first item.
    expect(pickNextActive([a, b], aClone)).toBe(a);
  });
});
