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
import {
  crumbsOf,
  isAuthoredComponentName,
  measureFrame,
  resolvePick,
} from '../src/native/inspector';

/**
 * Build a fake RN inspector hierarchy item. `paLoc` is the build-time
 * `data-pa-loc` value that rides on the item's first host descendant props
 * (what RN's `getInspectorData` surfaces); null means that host carries no
 * source — the case the breadcrumb fallback exists to cover.
 */
function item(name: string, paLoc: string | null) {
  return {
    name,
    getInspectorData: () => ({
      props: paLoc ? { 'data-pa-loc': paLoc } : {},
    }),
  };
}

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

describe('crumbsOf — every breadcrumb resolves to a real source', () => {
  // Hierarchy order is root-first, tapped-last (matches nameChainOf).
  it('keeps each crumb’s own data-pa-loc when present (distinct paths)', () => {
    const crumbs = crumbsOf({
      hierarchy: [
        item('App', 'src/index.tsx:1:1'),
        item('Screen', 'src/App.tsx:5:4'),
        item('Card', 'src/Screen.tsx:10:6'),
      ],
    });
    expect(crumbs.map((c) => `${c.name}@${c.loc?.file}:${c.loc?.line}`)).toEqual([
      'App@src/index.tsx:1',
      'Screen@src/App.tsx:5',
      'Card@src/Screen.tsx:10',
    ]);
  });

  it('re-anchors an untagged ancestor onto the nearest descendant source (the bug)', () => {
    // Only the tapped leaf carries a loc; previously App/Screen collapsed to
    // loc: null and re-focusing onto them showed a bare component name.
    const crumbs = crumbsOf({
      hierarchy: [item('App', null), item('Screen', null), item('Card', 'src/Screen.tsx:10:6')],
    });
    expect(crumbs.map((c) => c.loc)).toEqual([
      { file: 'src/Screen.tsx', line: 10, col: 6 },
      { file: 'src/Screen.tsx', line: 10, col: 6 },
      { file: 'src/Screen.tsx', line: 10, col: 6 },
    ]);
  });

  it('falls back to the nearest ancestor source when no descendant has one', () => {
    const crumbs = crumbsOf({
      hierarchy: [item('App', 'src/index.tsx:1:1'), item('Screen', null), item('Card', null)],
    });
    for (const c of crumbs) {
      expect(c.loc).toEqual({ file: 'src/index.tsx', line: 1, col: 1 });
    }
  });

  it('borrows a source from an untagged non-authored host between crumbs', () => {
    // RCTView is filtered out of the crumb list but still contributes its loc
    // to the nearest-source fallback for the authored crumbs around it.
    const crumbs = crumbsOf({
      hierarchy: [item('App', null), item('RCTView', 'src/Card.tsx:20:8'), item('Card', null)],
    });
    expect(crumbs.map((c) => c.name)).toEqual(['App', 'Card']);
    for (const c of crumbs) {
      expect(c.loc).toEqual({ file: 'src/Card.tsx', line: 20, col: 8 });
    }
  });

  it('leaves loc null when nothing in the hierarchy carries a source', () => {
    const crumbs = crumbsOf({
      hierarchy: [item('App', null), item('Screen', null)],
    });
    expect(crumbs.map((c) => c.loc)).toEqual([null, null]);
  });

  it('returns an empty chain for a missing/empty hierarchy', () => {
    expect(crumbsOf({})).toEqual([]);
    expect(crumbsOf({ hierarchy: [] })).toEqual([]);
  });
});

describe('measureFrame — per-crumb highlight rect', () => {
  it('resolves null when there is no measure fn', async () => {
    expect(await measureFrame(undefined)).toBeNull();
  });

  it('maps the measure callback to a window-coordinate frame (pageX/pageY)', async () => {
    // RN signature: (x, y, width, height, pageX, pageY)
    const frame = await measureFrame((cb) => cb(1, 2, 100, 40, 30, 80));
    expect(frame).toEqual({ x: 30, y: 80, width: 100, height: 40 });
  });

  it('treats a zero-size measurement as no frame', async () => {
    expect(await measureFrame((cb) => cb(0, 0, 0, 0, 5, 5))).toBeNull();
  });

  it('resolves null if the measure never calls back (guarded)', async () => {
    expect(await measureFrame(() => {})).toBeNull();
  });
});
