// SPDX-License-Identifier: Apache-2.0
// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeUnionCropRect } from '../src/crop';

// Helper — drop a div at (left, top) with given size into the body and
// stub its `getBoundingClientRect` so happy-dom (which doesn't run
// layout) reports the values we care about.
function makeBox(id: string, rect: { left: number; top: number; width: number; height: number }) {
  const el = document.createElement('div');
  el.id = id;
  document.body.appendChild(el);
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    x: rect.left,
    y: rect.top,
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    toJSON: () => ({}),
  } as DOMRect);
  return el;
}

beforeEach(() => {
  document.body.innerHTML = '';
  window.scrollTo(0, 0);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('computeUnionCropRect', () => {
  it('returns null when there are no extras (single-pick stays full-page)', () => {
    const primary = makeBox('p', { left: 10, top: 20, width: 100, height: 50 });
    expect(computeUnionCropRect(primary, [])).toBeNull();
  });

  it('returns the union of primary + a live extra, with 16px padding, in document coords', () => {
    const primary = makeBox('p', { left: 100, top: 100, width: 50, height: 50 });
    makeBox('extra', { left: 200, top: 300, width: 40, height: 40 });

    const rect = computeUnionCropRect(primary, [
      { selector: '#extra', file: null, line: null, col: null },
    ]);

    expect(rect).not.toBeNull();
    // union before padding: left=100 top=100 right=240 bottom=340
    // → with 16px padding: x=84 y=84 w=172 h=272
    expect(rect).toEqual({ x: 84, y: 84, w: 172, h: 272 });
  });

  it('adds window.scrollX / scrollY so the rect lands in document coords', () => {
    const primary = makeBox('p', { left: 0, top: 0, width: 50, height: 50 });
    makeBox('extra', { left: 100, top: 100, width: 50, height: 50 });

    // Pretend the page has been scrolled — the rect is the viewport-space
    // bbox, but the output must be document-space.
    vi.spyOn(window, 'scrollX', 'get').mockReturnValue(200);
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(400);

    const rect = computeUnionCropRect(primary, [
      { selector: '#extra', file: null, line: null, col: null },
    ]);

    // viewport union: left=0 top=0 right=150 bottom=150
    // doc union (after scroll): left=200 top=400 right=350 bottom=550
    // with 16px padding: x=184 y=384 w=182 h=182
    expect(rect).toEqual({ x: 184, y: 384, w: 182, h: 182 });
  });

  it('clamps negative document coords to zero (primary at the viewport edge while scrolled to 0)', () => {
    const primary = makeBox('p', { left: 0, top: 0, width: 20, height: 20 });
    makeBox('extra', { left: 5, top: 5, width: 20, height: 20 });

    const rect = computeUnionCropRect(primary, [
      { selector: '#extra', file: null, line: null, col: null },
    ]);

    expect(rect).not.toBeNull();
    // padding would push x/y to -16; clamp to 0.
    expect(rect?.x).toBe(0);
    expect(rect?.y).toBe(0);
  });

  it('skips extras whose selector no longer matches anything in the DOM', () => {
    const primary = makeBox('p', { left: 100, top: 100, width: 50, height: 50 });
    // No element with id="ghost" — selector lookup will fail.

    const rect = computeUnionCropRect(primary, [
      { selector: '#ghost', file: null, line: null, col: null },
    ]);

    // Primary is live so we still get a rect — just bounded by the primary.
    expect(rect).toEqual({ x: 84, y: 84, w: 82, h: 82 });
  });

  it('returns null when neither primary nor any extra is reachable', () => {
    // Build, then detach, the primary; give the extras a selector that
    // matches nothing. Nothing live remains.
    const primary = document.createElement('div');
    // Never appended → isConnected is false.

    const rect = computeUnionCropRect(primary, [
      { selector: '#nonexistent', file: null, line: null, col: null },
    ]);

    expect(rect).toBeNull();
  });
});
