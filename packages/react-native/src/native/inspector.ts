// SPDX-License-Identifier: Apache-2.0
/**
 * Tap point → source location, the React Native way.
 *
 * This is the RN analog of the web widget's DOM walk for `data-pa-loc`.
 * RN's own dev Inspector (Dev Menu → "Show Inspector") resolves a touch
 * to a component + source file using exactly this internal API; we lean
 * on the same machinery rather than reinventing it.
 *
 * Source data comes from the `data-pa-loc="file:line:col"` prop the
 * `@pinagent/react-native/babel` plugin splices onto every authored JSX
 * element at build time — the exact RN analog of the web babel plugin's
 * DOM attribute. The plugin's prop rides along on the host fiber's
 * `memoizedProps`, which `getInspectorDataForViewAtPoint` hands back to us
 * as `data.props`, so the tapped view resolves to its source directly.
 *
 * Why a build-time prop instead of RN's old `_debugSource`: React 19
 * deleted `_debugSource`, and RN 0.81+ dropped the `source` field from the
 * inspector payload — neither carries a source location anymore. We still
 * read both as a fallback for older RN/React, then degrade to `loc: null`.
 *
 * Both the module path AND the payload shape returned by
 * `getInspectorDataForViewAtPoint` have shifted across RN versions, so
 * every read here is defensive: we extract what we can and degrade to
 * `loc: null` rather than throw inside a tap handler.
 */
import type { PickResult } from './types';

// Internal RN module — not a public export, but the path has been stable
// and is what the built-in Inspector imports. Typed loosely on purpose.
//
// `inspectedView` must be a **host component public instance** (a view ref's
// `.current`), NOT a `findNodeHandle` tag: on Fabric the renderer calls
// `getNodeFromPublicInstance(inspectedView)` and then hit-tests *within that
// view's shadow subtree*. A number fails the guard ("expects to receive a
// host component"); the instance must also be an ancestor of the tapped view,
// so we pass the app root (see `rootHostInstance`), not pinagent's overlay.
// eslint-disable-next-line @typescript-eslint/no-var-requires
type InspectorFn = (
  inspectedView: unknown,
  locationX: number,
  locationY: number,
  callback: (data: RawInspectorData) => void,
) => void;

interface RawFiberLike {
  fileName?: string;
  lineNumber?: number;
  columnNumber?: number;
}

type RawProps = Record<string, unknown> | null | undefined;

interface RawHierarchyItem {
  name?: string;
  getInspectorData?: (toFiber: unknown) => {
    /** Removed in RN 0.81+, kept for back-compat. */
    source?: RawFiberLike | null;
    /** The host fiber's `memoizedProps` — carries our `data-pa-loc`. */
    props?: RawProps;
  };
}

interface RawInspectorData {
  frame?: { left: number; top: number; width: number; height: number } | null;
  hierarchy?: RawHierarchyItem[];
  /** Newer RN returns the closest fiber directly. */
  closestInstance?: { _debugSource?: RawFiberLike } | null;
  /** Some versions surface the resolved source straight on the payload. */
  source?: RawFiberLike | null;
  /** The tapped host view's props — where `data-pa-loc` lands. */
  props?: RawProps;
}

let cachedFn: InspectorFn | null | undefined;

function asFn(mod: unknown): InspectorFn | null {
  const fn = (mod as { default?: unknown })?.default ?? mod;
  return typeof fn === 'function' ? (fn as InspectorFn) : null;
}

function loadInspector(): InspectorFn | null {
  if (cachedFn !== undefined) return cachedFn;
  // The inspector module moved in RN 0.81:
  //   Libraries/Inspector/… → src/private/devsupport/devmenu/elementinspector/…
  // We require the RN 0.81+ path only and deliberately do NOT fall back to the
  // pre-0.81 `Libraries/Inspector/…` path: that file no longer exists on modern
  // RN, so a static `require` of it makes Metro's resolver log an "invalid
  // package.json / file does not exist" warning on every bundle (RN's `./*`
  // exports entry maps it to a missing `.js`). The legacy inspector also
  // predates the build-time `data-pa-loc` prop this package relies on, so it
  // couldn't carry a location anyway — pre-0.81 RN degrades to `loc: null`.
  // Lazy so a production build (widget tree-shaken / `__DEV__`-gated away)
  // never reaches into RN internals.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const fn = asFn(
      require('react-native/src/private/devsupport/devmenu/elementinspector/getInspectorDataForViewAtPoint'),
    );
    if (fn) {
      cachedFn = fn;
      return cachedFn;
    }
  } catch {
    // Module absent (release build, Node/CI, or an RN version that moved it).
  }
  cachedFn = null;
  return cachedFn;
}

// React fiber tag for a host component (`<View>`, `<Text>`, …). Stable across
// React versions.
const HOST_COMPONENT = 5;

interface FiberLike {
  tag?: number;
  return?: FiberLike | null;
  stateNode?: { canonical?: { publicInstance?: unknown } } | null;
}

let cachedGetHandle: ((instance: unknown) => FiberLike | null) | null | undefined;

function getHandleFromPublicInstance(instance: unknown): FiberLike | null {
  if (cachedGetHandle === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
      const RNPrivate = require('react-native/Libraries/ReactPrivate/ReactNativePrivateInterface');
      const fn = RNPrivate?.getInternalInstanceHandleFromPublicInstance;
      cachedGetHandle = typeof fn === 'function' ? fn : null;
    } catch {
      cachedGetHandle = null;
    }
  }
  try {
    return cachedGetHandle ? cachedGetHandle(instance) : null;
  } catch {
    return null;
  }
}

/**
 * Climb from pinagent's own overlay view to the app's **root** host view and
 * return its public instance.
 *
 * Why: `getInspectorDataForViewAtPoint` hit-tests *within* the shadow subtree
 * of the instance we pass. pinagent mounts as a sibling/descendant of the
 * app, so its own view's subtree doesn't contain the tapped component — we
 * must hand the inspector an ancestor that does. RN's built-in Inspector uses
 * `AppContainer`'s inner root view for exactly this; we reach the same node by
 * walking the fiber `return` chain to the topmost host component.
 *
 * Defensive: any failure (Paper, an RN internals shuffle, a null handle)
 * falls back to the instance we were given — the picker degrades, never
 * throws.
 */
function rootHostInstance(publicInstance: unknown): unknown {
  let fiber = getHandleFromPublicInstance(publicInstance);
  if (!fiber) return publicInstance;
  let topHost: FiberLike | null = null;
  // Cap the walk — a malformed `return` cycle must not spin forever.
  for (let i = 0; fiber && i < 10_000; i++) {
    if (fiber.tag === HOST_COMPONENT) topHost = fiber;
    fiber = fiber.return ?? null;
  }
  const rootInstance = topHost?.stateNode?.canonical?.publicInstance;
  return rootInstance ?? publicInstance;
}

/**
 * Turn an absolute `_debugSource.fileName` into the project-relative,
 * POSIX path the rest of pinagent expects (matching what the web babel
 * plugin emits). Falls back to the raw filename if it isn't under root.
 */
function toProjectRelative(fileName: string, projectRoot: string): string {
  const norm = fileName.replace(/\\/g, '/');
  const root = projectRoot.replace(/\\/g, '/').replace(/\/+$/, '');
  if (root && norm.startsWith(`${root}/`)) return norm.slice(root.length + 1);
  return norm;
}

type Loc = NonNullable<PickResult['loc']>;

/**
 * Parse a `data-pa-loc` value (`"src/Foo.tsx:42:7"`) into a {@link Loc}.
 * The path may itself contain colons on exotic platforms, so we split off
 * the trailing `:line:col` rather than splitting greedily.
 */
function parsePaLoc(value: unknown): Loc | null {
  if (typeof value !== 'string') return null;
  const m = /^(.*):(\d+):(\d+)$/.exec(value);
  if (!m) return null;
  return { file: m[1]!, line: Number(m[2]), col: Number(m[3]) };
}

/** The first `data-pa-loc` found on the tapped view or its nearest owner. */
function paLocOf(props: RawProps): Loc | null {
  return parsePaLoc(props?.['data-pa-loc']);
}

/**
 * Resolve the source location. Preferred path: the build-time `data-pa-loc`
 * prop our babel plugin splices on (read from the tapped host view's props,
 * then from each owner outward). Fallback: RN's legacy `_debugSource` /
 * inspector `source` field, for older RN/React where they still exist.
 */
function pickLoc(data: RawInspectorData, projectRoot: string): Loc | null {
  // 1. `data-pa-loc` on the directly tapped host view.
  const direct = paLocOf(data.props);
  if (direct) return direct;

  // 2. `data-pa-loc` walking the owner hierarchy from the tapped element out.
  for (let i = (data.hierarchy?.length ?? 0) - 1; i >= 0; i--) {
    const item = data.hierarchy?.[i];
    const loc = paLocOf(item?.getInspectorData?.(() => null)?.props);
    if (loc) return loc;
  }

  // 3. Legacy `_debugSource` / inspector `source` (pre-React-19 / pre-0.81).
  const src = legacySource(data);
  if (src?.fileName && typeof src.lineNumber === 'number') {
    return {
      file: toProjectRelative(src.fileName, projectRoot),
      line: src.lineNumber,
      col: src.columnNumber ?? 0,
    };
  }
  return null;
}

function legacySource(data: RawInspectorData): RawFiberLike | null {
  if (data.source?.fileName) return data.source;
  if (data.closestInstance?._debugSource?.fileName) {
    return data.closestInstance._debugSource;
  }
  for (let i = (data.hierarchy?.length ?? 0) - 1; i >= 0; i--) {
    const item = data.hierarchy?.[i];
    const src = item?.getInspectorData?.(() => null)?.source;
    if (src?.fileName) return src;
  }
  return null;
}

/**
 * Keep only authored React components in the breadcrumb. Two kinds of noise
 * are hidden because clicking them is meaningless — they map to no source the
 * developer can act on:
 *
 *  - **Native host components** — RN's view classes, named `RCT…`
 *    (`RCTText`, `RCTView`, `RCTScrollView`, …).
 *  - **HOC / wrapper display names** — parenthesized by convention
 *    (`withDevTools(App)`, `ForwardRef(X)`, `Memo(X)`, `Connect(X)`).
 *
 * Identifiers can't contain `(`, so a parenthesized name is always a wrapper.
 */
export function isAuthoredComponentName(name: unknown): name is string {
  return (
    typeof name === 'string' && name.length > 0 && !name.startsWith('RCT') && !name.includes('(')
  );
}

function nameChainOf(data: RawInspectorData): string[] {
  return (data.hierarchy ?? []).map((h) => h.name).filter(isAuthoredComponentName);
}

/**
 * Build the per-segment breadcrumb: each authored component in the hierarchy
 * paired with its own `data-pa-loc` (so a press can re-anchor onto that
 * ancestor). Same order as {@link nameChainOf} — root first, tapped last.
 */
function crumbsOf(data: RawInspectorData): { name: string; loc: Loc | null }[] {
  return (data.hierarchy ?? [])
    .filter((h): h is RawHierarchyItem & { name: string } => isAuthoredComponentName(h.name))
    .map((h) => ({ name: h.name, loc: paLocOf(h.getInspectorData?.(() => null)?.props) }));
}

/**
 * Resolve a tap (in window coordinates) to a {@link PickResult}.
 *
 * @param rootView  A host view instance from which to reach the app root —
 *   pass a ref's `.current` (the widget passes its own overlay `<View>`).
 *   We climb to the app-root host instance before hit-testing, since the
 *   inspector searches within the passed view's subtree. NOT a
 *   `findNodeHandle` number — the Fabric inspector rejects a bare tag.
 */
export function resolvePick(
  rootView: unknown,
  x: number,
  y: number,
  projectRoot: string,
): Promise<PickResult> {
  const fn = loadInspector();
  if (!fn) {
    // Inspector unavailable (release build, or an RN version that moved
    // the module). Degrade gracefully — the comment can still be filed
    // with `loc: null`, which the server accepts.
    return Promise.resolve({ loc: null, nameChain: [], chain: [], frame: null });
  }
  const inspectedView = rootHostInstance(rootView);
  return new Promise((resolve) => {
    let settled = false;
    const done = (r: PickResult) => {
      if (!settled) {
        settled = true;
        resolve(r);
      }
    };
    // The callback is sometimes never invoked if the point misses every
    // view; guard with a microtask-ish fallback so the picker can't hang.
    const timer = setTimeout(() => done({ loc: null, nameChain: [], chain: [], frame: null }), 250);
    try {
      fn(inspectedView, x, y, (data) => {
        clearTimeout(timer);
        const frame = data.frame
          ? {
              x: data.frame.left,
              y: data.frame.top,
              width: data.frame.width,
              height: data.frame.height,
            }
          : null;
        done({
          loc: pickLoc(data, projectRoot),
          nameChain: nameChainOf(data),
          chain: crumbsOf(data),
          frame,
        });
      });
    } catch {
      clearTimeout(timer);
      done({ loc: null, nameChain: [], chain: [], frame: null });
    }
  });
}
