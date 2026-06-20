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
  frameContains,
  isAuthoredComponentName,
  measureFrame,
  measureHitTest,
  nearestPaLocUp,
  resolvePick,
  taggedAncestors,
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

describe('nearestPaLocUp — resolve the tapped leaf, not its owner’s container', () => {
  // Minimal fiber-like chain, leaf → parents via `return`. RN's inspector
  // surfaces `data.props` as the nearest composite owner's FIRST host (an outer
  // container); this walk instead reads the host actually under the finger.
  type Fib = { memoizedProps?: Record<string, unknown>; return?: Fib | null };
  const fib = (paLoc: string | null, parent: Fib | null = null): Fib => ({
    memoizedProps: paLoc ? { 'data-pa-loc': paLoc } : {},
    return: parent,
  });

  it('returns the tapped host’s own loc when that exact host is tagged', () => {
    // The leaf the developer tapped — NOT its screen/card container parent.
    const leaf = fib('src/StepsCard.tsx:12:4', fib('src/_layout.tsx:89:6'));
    expect(nearestPaLocUp(leaf)).toEqual({ file: 'src/StepsCard.tsx', line: 12, col: 4 });
  });

  it('climbs to the nearest tagged ancestor when the exact host is untagged', () => {
    // Tapped host is a 3rd-party / RN-internal view carrying no data-pa-loc;
    // resolve the nearest authored element enclosing it (still leaf-ward).
    const leaf = fib(null, fib(null, fib('src/Card.tsx:9:6')));
    expect(nearestPaLocUp(leaf)).toEqual({ file: 'src/Card.tsx', line: 9, col: 6 });
  });

  it('returns null when nothing in the parent chain is tagged', () => {
    expect(nearestPaLocUp(fib(null, fib(null)))).toBeNull();
  });

  it('returns null for a missing fiber (instance could not be bridged)', () => {
    expect(nearestPaLocUp(null)).toBeNull();
  });

  it('terminates on a malformed `return` cycle instead of spinning', () => {
    const a = fib(null);
    a.return = a; // self-referential cycle
    expect(nearestPaLocUp(a)).toBeNull();
  });
});

describe('frameContains — window-coordinate hit test', () => {
  const f = { x: 10, y: 20, width: 100, height: 40 };
  it('is true for a point inside', () => expect(frameContains(f, 50, 30)).toBe(true));
  it('is inclusive on the edges', () => {
    expect(frameContains(f, 10, 20)).toBe(true);
    expect(frameContains(f, 110, 60)).toBe(true);
  });
  it('is false outside (each axis)', () => {
    expect(frameContains(f, 9, 30)).toBe(false);
    expect(frameContains(f, 50, 61)).toBe(false);
  });
});

/**
 * Minimal fiber-like node for the measure-fallback tests. `__frame` is the rect
 * the injected `measure` returns for that host — so the DFS runs with no RN
 * runtime. `link` wires child/sibling/return the way React fibers are shaped.
 */
type TFib = {
  tag: number;
  memoizedProps?: Record<string, unknown>;
  child?: TFib | null;
  sibling?: TFib | null;
  return?: TFib | null;
  __frame?: { x: number; y: number; width: number; height: number } | null;
};
const HOST = 5;
function link(node: TFib, children: TFib[]): TFib {
  node.child = children[0] ?? null;
  children.forEach((c, i) => {
    c.return = node;
    c.sibling = children[i + 1] ?? null;
  });
  return node;
}
function host(
  loc: string | null,
  frame: TFib['__frame'],
  children: TFib[] = [],
  comp?: string,
): TFib {
  const props: Record<string, unknown> = {};
  if (loc) props['data-pa-loc'] = loc;
  if (comp) props['data-pa-comp'] = comp;
  return link({ tag: HOST, memoizedProps: props, __frame: frame }, children);
}
/** A composite (function-component) fiber — no frame; the DFS descends through it. */
function comp(children: TFib[] = []): TFib {
  return link({ tag: 0, memoizedProps: {} }, children);
}
const measure = (fiber: { __frame?: TFib['__frame'] }) => Promise.resolve(fiber.__frame ?? null);

describe('measureHitTest — fiber-measure fallback when findNodeAtPoint can’t descend', () => {
  // root[0,0,100,100] → (composite) → A[0,0,50,50] → A-text[5,5,40,10]
  //                                 → B[50,0,50,50]
  const tree = () =>
    host('outer.tsx:1:1', { x: 0, y: 0, width: 100, height: 100 }, [
      comp([
        host('cardA.tsx:5:1', { x: 0, y: 0, width: 50, height: 50 }, [
          host('textA.tsx:6:1', { x: 5, y: 5, width: 40, height: 10 }, [], 'TextA'),
        ]),
        host('cardB.tsx:7:1', { x: 50, y: 0, width: 50, height: 50 }, [], 'CardB'),
      ]),
    ]);

  it('resolves the DEEPEST tagged host containing the tap (the leaf)', async () => {
    const hit = await measureHitTest(tree(), 10, 8, measure);
    expect(hit?.loc).toEqual({ file: 'textA.tsx', line: 6, col: 1 });
    expect(hit?.name).toBe('TextA');
  });

  it('falls to the nearest tagged ancestor when the deepest containing host is untagged', async () => {
    // Tap inside cardA but outside its (text) child → cardA wins.
    const hit = await measureHitTest(tree(), 10, 30, measure);
    expect(hit?.loc).toEqual({ file: 'cardA.tsx', line: 5, col: 1 });
  });

  it('descends through composite fibers to reach a sibling subtree', async () => {
    const hit = await measureHitTest(tree(), 70, 30, measure);
    expect(hit?.loc).toEqual({ file: 'cardB.tsx', line: 7, col: 1 });
  });

  it('prunes the subtree of a host whose frame misses the tap (no overflow chase)', async () => {
    // `inner` would contain (55,55) but its parent `clip` does not → pruned;
    // only the root contains, so the root wins.
    const t = host('root.tsx:1:1', { x: 0, y: 0, width: 100, height: 100 }, [
      host(null, { x: 0, y: 0, width: 20, height: 20 }, [
        host('inner.tsx:9:1', { x: 50, y: 50, width: 10, height: 10 }),
      ]),
    ]);
    const hit = await measureHitTest(t, 55, 55, measure);
    expect(hit?.loc).toEqual({ file: 'root.tsx', line: 1, col: 1 });
  });

  it('returns null when nothing containing the tap is tagged', async () => {
    const t = host(null, { x: 0, y: 0, width: 100, height: 100 }, [
      host(null, { x: 0, y: 0, width: 50, height: 50 }),
    ]);
    expect(await measureHitTest(t, 10, 10, measure)).toBeNull();
  });

  it('returns null for a tap outside the root and for a null root', async () => {
    expect(await measureHitTest(tree(), 999, 999, measure)).toBeNull();
    expect(await measureHitTest(null, 10, 10, measure)).toBeNull();
  });
});

describe('taggedAncestors — measure-fallback breadcrumb from the fiber return chain', () => {
  it('collects distinct tagged hosts root-first, naming them from data-pa-comp', () => {
    const card = host('card.tsx:1:1', null, [], 'Card');
    const wrapper = host('leaf.tsx:3:2', null, [], 'Leaf'); // forwarding wrapper host
    const leaf = host('leaf.tsx:3:2', null, [], 'Leaf'); // same loc → dedup
    const composite = comp([]);
    leaf.return = wrapper;
    wrapper.return = composite;
    composite.return = card;
    const chain = taggedAncestors(leaf);
    expect(chain.map((c) => `${c.name}@${c.loc.file}:${c.loc.line}`)).toEqual([
      'Card@card.tsx:1',
      'Leaf@leaf.tsx:3',
    ]);
  });

  it('defaults an unnamed tagged host to "View" and ignores untagged hosts', () => {
    const root = host('root.tsx:2:1', null, [], undefined); // no data-pa-comp
    const untagged = host(null, null);
    untagged.return = root;
    const chain = taggedAncestors(untagged);
    expect(chain).toEqual([
      { name: 'View', loc: { file: 'root.tsx', line: 2, col: 1 }, fiber: root },
    ]);
  });

  it('returns an empty chain for a null leaf', () => {
    expect(taggedAncestors(null)).toEqual([]);
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
