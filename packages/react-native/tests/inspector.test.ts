// SPDX-License-Identifier: Apache-2.0
/**
 * `resolvePick` — tap point → source location (src/native/inspector.ts).
 *
 * resolvePick leans on RN's internal
 * `react-native/src/private/devsupport/devmenu/elementinspector/getInspectorDataForViewAtPoint`
 * (RN 0.81+), which is only present in a real RN dev runtime. This package intentionally does
 * NOT install react-native (the native client ships as source — see the
 * package.json `//peers` note), so in Node/CI that module is absent — the
 * SAME situation as a release build or an RN version that moved the module.
 *
 * That's exactly the contract these tests pin: when the inspector is
 * unavailable, resolvePick must DEGRADE GRACEFULLY — never throw inside the
 * tap handler, and resolve to a safe `{ loc: null, nameChain: [], chain: [], frame: null }`
 * so the comment can still be filed (the server accepts `loc: null`). The
 * on-device source-extraction path is covered by RN's own dev Inspector plus
 * manual testing.
 */
import { describe, expect, it } from 'vitest';
import { isAuthoredComponentName, resolvePick } from '../src/native/inspector';

describe('resolvePick — graceful degradation when the RN inspector is unavailable', () => {
  it('resolves to a safe null pick instead of throwing', async () => {
    const result = await resolvePick(7, 100, 200, '/proj');
    expect(result).toEqual({ loc: null, nameChain: [], chain: [], frame: null });
  });

  it('tolerates a null rootTag (no inspected root)', async () => {
    const result = await resolvePick(null, 0, 0, '/proj');
    expect(result).toEqual({ loc: null, nameChain: [], chain: [], frame: null });
  });

  it('returns the same safe shape on repeated calls (memoised unavailability)', async () => {
    // loadInspector caches the failed lookup; a second call must still
    // resolve to the safe default rather than retry-and-throw.
    const a = await resolvePick(1, 10, 10, '/some/root');
    const b = await resolvePick(2, 20, 20, '/other/root');
    expect(a).toEqual({ loc: null, nameChain: [], chain: [], frame: null });
    expect(b).toEqual(a);
  });
});

describe('isAuthoredComponentName — breadcrumb noise filter', () => {
  it('keeps authored React components', () => {
    for (const name of ['App', 'HomeScreen', 'FeatureCard', 'View', 'Text']) {
      expect(isAuthoredComponentName(name)).toBe(true);
    }
  });

  it('drops native host components (RCT-prefixed)', () => {
    for (const name of ['RCTText', 'RCTView', 'RCTScrollView', 'RCTSinglelineTextInputView']) {
      expect(isAuthoredComponentName(name)).toBe(false);
    }
  });

  it('drops HOC / wrapper display names (parenthesized)', () => {
    for (const name of ['withDevTools(App)', 'ForwardRef(Card)', 'Memo(Row)', 'Connect(List)']) {
      expect(isAuthoredComponentName(name)).toBe(false);
    }
  });

  it('drops empty / non-string names', () => {
    expect(isAuthoredComponentName('')).toBe(false);
    expect(isAuthoredComponentName(undefined)).toBe(false);
    expect(isAuthoredComponentName(null)).toBe(false);
  });
});
