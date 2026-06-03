// SPDX-License-Identifier: Apache-2.0
// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { deepElementFromPoint } from '../src/picker';

// `elementFromPoint` is geometry-based and not meaningfully implemented in
// happy-dom, so we stub it (and each shadow root's) to model what a real
// browser returns: the outer call yields a shadow *host*, the host's shadow
// root yields the real leaf. That's exactly the case the helper exists for.
const origDocFromPoint = document.elementFromPoint;

afterEach(() => {
  document.body.innerHTML = '';
  document.elementFromPoint = origDocFromPoint;
});

describe('deepElementFromPoint', () => {
  it('returns the element directly when it has no shadow root', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    document.elementFromPoint = () => el;
    expect(deepElementFromPoint(5, 5)).toBe(el);
  });

  it('descends through an open shadow root to the real leaf', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: 'open' });
    const leaf = document.createElement('span');
    root.appendChild(leaf);
    // The browser would return the host from the outer call…
    document.elementFromPoint = () => host;
    // …and the leaf from the host's shadow root.
    root.elementFromPoint = () => leaf;
    expect(deepElementFromPoint(5, 5)).toBe(leaf);
  });

  it('descends through nested shadow roots', () => {
    const outer = document.createElement('div');
    document.body.appendChild(outer);
    const outerRoot = outer.attachShadow({ mode: 'open' });
    const inner = document.createElement('div');
    outerRoot.appendChild(inner);
    const innerRoot = inner.attachShadow({ mode: 'open' });
    const leaf = document.createElement('span');
    innerRoot.appendChild(leaf);
    document.elementFromPoint = () => outer;
    outerRoot.elementFromPoint = () => inner;
    innerRoot.elementFromPoint = () => leaf;
    expect(deepElementFromPoint(5, 5)).toBe(leaf);
  });

  it('stops at the host when the shadow root yields nothing (e.g. closed-like)', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: 'open' });
    document.elementFromPoint = () => host;
    root.elementFromPoint = () => null;
    expect(deepElementFromPoint(5, 5)).toBe(host);
  });
});
